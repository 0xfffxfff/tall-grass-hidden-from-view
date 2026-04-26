import { useCallback, useEffect, useState } from "react";
import { fheWorker, setLogHandler } from "@/fheWorkerClient";
import { workBus } from "@/lib/workBus";

export type FheStatus =
  | "idle"
  | "loading-wasm"
  | "loading-key"
  | "ready"
  | "error";

interface UseFheResult {
  status: FheStatus;
  message: string;
  ensureReady: () => Promise<void>;
  compare: (a: number, b: number, trait: number) => Promise<{ gtHex: string; eqHex: string }>;
}

let bootstrapPromise: Promise<void> | null = null;

export function useFhe(): UseFheResult {
  const [status, setStatus] = useState<FheStatus>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLogHandler((m) => {
      setMessage(m);
      // Surface fine-grained worker progress (e.g. ciphertext fetch) on the
      // public strip while bootstrap is in flight.
      if (bootstrapPromise) workBus.update("fhe-bootstrap", m);
    });
  }, []);

  const ensureReady = useCallback(async () => {
    if (bootstrapPromise) {
      await bootstrapPromise;
      setStatus("ready");
      return;
    }
    bootstrapPromise = (async () => {
      workBus.start({
        id: "fhe-bootstrap",
        scope: "public",
        label: "loading FHE runtime",
      });
      setStatus("loading-wasm");
      setMessage("loading wasm");
      await fheWorker.init();
      workBus.update("fhe-bootstrap", "downloading cloud key (~78 MB)");
      setStatus("loading-key");
      setMessage("loading cloud key (~78 MB)");
      await fheWorker.loadCloudKey();
      setStatus("ready");
      setMessage("");
      workBus.end("fhe-bootstrap");
    })().catch((e) => {
      bootstrapPromise = null;
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "FHE init failed");
      workBus.end("fhe-bootstrap");
      throw e;
    });
    await bootstrapPromise;
  }, []);

  const compare = useCallback(
    async (a: number, b: number, trait: number) => {
      await ensureReady();
      const id = `fhe-compare-${a}-${b}-${trait}`;
      workBus.start({
        id,
        scope: "public",
        label: `homomorphic compare #${pad2(a)} \u00B7 #${pad2(b)} \u00B7 trait ${trait}`,
      });
      try {
        return await fheWorker.compare(a, b, trait);
      } finally {
        workBus.end(id);
      }
    },
    [ensureReady],
  );

  return { status, message, ensureReady, compare };
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}
