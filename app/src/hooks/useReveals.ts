import { useCallback, useEffect, useRef, useState } from "react";
import { api, type RevealRecord } from "@/api";

const POLL_INTERVAL_MS = 5000;

export interface RevealsState {
  entityCount: number;
  traitCount: number;
  reveals: RevealRecord[];
  loading: boolean;
}

export function useReveals(): RevealsState & {
  prepend: (rec: RevealRecord) => void;
} {
  const [entityCount, setEntityCount] = useState(32);
  const [traitCount, setTraitCount] = useState(7);
  const [reveals, setReveals] = useState<RevealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const lastSeenRef = useRef(0);
  // Tracks pair-trait keys we've already emitted, so polling doesn't double-add
  // a reveal we just optimistically prepended client-side.
  const seenKeysRef = useRef<Set<string>>(new Set());

  const ingest = useCallback((batch: RevealRecord[], replace: boolean) => {
    if (batch.length === 0 && !replace) return;
    setReveals((prev) => {
      let next = prev;
      if (replace) {
        next = [];
        seenKeysRef.current.clear();
      }
      const additions: RevealRecord[] = [];
      for (const r of batch) {
        const key = `${r.a}_${r.b}_${r.trait}_${r.revealedAt}`;
        if (seenKeysRef.current.has(key)) continue;
        seenKeysRef.current.add(key);
        additions.push(r);
        if (r.revealedAt > lastSeenRef.current) lastSeenRef.current = r.revealedAt;
      }
      if (additions.length === 0 && !replace) return prev;
      const merged = [...additions, ...next];
      merged.sort((a, b) => b.revealedAt - a.revealedAt);
      return merged;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick(initial: boolean) {
      try {
        const since = initial ? 0 : lastSeenRef.current;
        const data = await api.reveals(since);
        if (cancelled) return;
        if (initial) {
          setEntityCount(data.entityCount);
          setTraitCount(data.traitCount);
        }
        ingest(data.reveals, initial);
        if (initial) setLoading(false);
      } catch {
        // Ignore — try again on next tick.
      } finally {
        if (!cancelled) timer = setTimeout(() => tick(false), POLL_INTERVAL_MS);
      }
    }

    tick(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ingest]);

  const prepend = useCallback((rec: RevealRecord) => {
    ingest([rec], false);
  }, [ingest]);

  return { entityCount, traitCount, reveals, loading, prepend };
}
