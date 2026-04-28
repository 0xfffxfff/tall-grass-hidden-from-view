import { useCallback, useEffect, useState } from "react";

// Per-wallet, localStorage-backed set of entity IDs the connected
// address has encountered. Encounters are personal cryptographic
// events: walking onto a tall grass cell where an entity stands.
// We persist them client-side so the encounterer can see the entity
// in their own view (registry tile, modal preview, encounter card)
// without changing the public mint-reveals-publicly invariant.
//
// Storage is plain localStorage keyed by lowercased address. Different
// devices keep independent encounter sets — that is acceptable and
// honest: encountering is a local event of having walked.

const KEY_PREFIX = "tg:encountered:";

function storageKey(address: string | undefined): string | null {
  if (!address) return null;
  return KEY_PREFIX + address.toLowerCase();
}

function readSet(key: string | null): Set<number> {
  if (!key) return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is number => Number.isInteger(x)));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<number>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set].sort((a, b) => a - b)));
  } catch {
    // localStorage write can fail (quota, private mode). Silent — the
    // in-memory set in the hook still reflects the new state for the
    // session, and we don't want to crash on a non-critical write.
  }
}

export function useEncounteredEntities(address: string | undefined): {
  ids: Set<number>;
  mark: (id: number) => void;
} {
  const key = storageKey(address);
  const [ids, setIds] = useState<Set<number>>(() => readSet(key));

  // Re-read from storage whenever the keyed address changes.
  useEffect(() => {
    setIds(readSet(key));
  }, [key]);

  // Sync across tabs of the same wallet via the storage event.
  useEffect(() => {
    if (!key) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setIds(readSet(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const mark = useCallback(
    (id: number) => {
      if (!key) return;
      setIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        writeSet(key, next);
        return next;
      });
    },
    [key],
  );

  return { ids, mark };
}
