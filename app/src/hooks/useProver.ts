import { useEffect, useRef, useState, useCallback } from "react";

let cachedProver: {
  prove: (inputs: Record<string, string>) => Promise<string>;
} | null = null;

export function useProver() {
  const [ready, setReady] = useState(!!cachedProver);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || cachedProver) return;
    initRef.current = true;

    (async () => {
      const [{ Noir }, { UltraHonkBackend }, circuitRes] = await Promise.all([
        import("@noir-lang/noir_js"),
        import("@aztec/bb.js"),
        fetch("/data/movement.json"),
      ]);

      const circuit = await circuitRes.json();
      const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
      const noir = new Noir(circuit);

      cachedProver = {
        prove: async (inputs: Record<string, string>) => {
          const { witness } = await noir.execute(inputs);
          const proof = await backend.generateProof(witness, { keccak: true });
          return "0x" + Buffer.from(proof.proof).toString("hex");
        },
      };
      setReady(true);
    })();
  }, []);

  const prove = useCallback(
    async (inputs: Record<string, string>): Promise<string> => {
      if (!cachedProver) throw new Error("Prover not ready");
      return cachedProver.prove(inputs);
    },
    []
  );

  return { ready, prove };
}
