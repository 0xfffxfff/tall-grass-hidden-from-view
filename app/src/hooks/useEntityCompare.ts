// Shared homomorphic-comparison flow used by both the heatmap (PublicGrid)
// and the entity modal. Wraps the FHE bootstrap, the WASM compare, and the
// oracle decryption call into a single click handler that pushes the new
// reveal upstream via `prepend`. Exposes the busy/flash state both surfaces
// need to render a pending or freshly-lit cell.

import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { useFhe } from "@/hooks/useFhe";
import { api, type RevealRecord } from "@/api";
import { workBus } from "@/lib/workBus";
import {
  pairKey,
  pairTraitKey,
  type LitByTrait,
} from "@/components/monolith/monolithLib";

interface Options {
  prepend: (rec: RevealRecord) => void;
  litByTrait?: LitByTrait;
}

export interface EntityCompareApi {
  busyKeys: Set<string>;
  flashKey: string | null;
  error: string;
  fhe: ReturnType<typeof useFhe>;
  runCompareOnPair: (a: number, b: number, t: number) => Promise<void>;
  clearError: () => void;
}

export function useEntityCompare({
  prepend,
  litByTrait,
}: Options): EntityCompareApi {
  const { address } = useAccount();
  const fhe = useFhe();

  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const runCompareOnPair = useCallback(
    async (a: number, b: number, t: number) => {
      const key = pairTraitKey(a, b, t);
      if (busyKeys.has(key)) return;
      if (litByTrait?.[t]?.has(pairKey(a, b))) return;
      setError("");
      setBusyKeys((prev) => new Set(prev).add(key));
      const decryptId = `oracle-decrypt-${key}`;
      try {
        await fhe.ensureReady();
        const { gtHex, eqHex } = await fhe.compare(a, b, t);
        workBus.start({
          id: decryptId,
          scope: "public",
          label: "oracle decrypting result",
        });
        const res = await api.compare(gtHex, eqHex, {
          entityA: a,
          entityB: b,
          traitIndex: t,
          revealer: address ?? undefined,
        });
        workBus.end(decryptId);
        const rec: RevealRecord = {
          a,
          b,
          trait: t,
          op: res.result,
          revealedAt: Date.now(),
          revealer: address?.toLowerCase() ?? "anon",
        };
        prepend(rec);
        setFlashKey(key);
        setTimeout(() => setFlashKey((k) => (k === key ? null : k)), 900);
      } catch (e) {
        setError(e instanceof Error ? e.message : "compare failed");
        workBus.end(decryptId);
      } finally {
        setBusyKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [busyKeys, litByTrait, fhe, address, prepend],
  );

  const clearError = useCallback(() => setError(""), []);

  return { busyKeys, flashKey, error, fhe, runCompareOnPair, clearError };
}
