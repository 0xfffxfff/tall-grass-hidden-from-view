import { useCallback, useRef, useState } from "react";
import {
  useWatchTallGrassEntityMovedEvent,
  useWatchTallGrassMovedEvent,
  useWatchTallGrassMintedEvent,
  useWatchTallGrassRegisteredEvent,
  useWatchTallGrassDepositedEvent,
} from "@/generated";

export interface ActivityEntry {
  id: number;
  timestamp: string;
  type: string;
  address: string;
  detail?: string;
}

function truncate(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function ts(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const MAX_ENTRIES = 50;

export function useActivity(): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const nextId = useRef(0);

  const push = useCallback((type: string, address: string, detail?: string) => {
    setEntries((prev) => {
      const entry: ActivityEntry = {
        id: nextId.current++,
        timestamp: ts(),
        type,
        address: truncate(address),
        detail,
      };
      return [entry, ...prev].slice(0, MAX_ENTRIES);
    });
  }, []);

  const onMoved = useCallback((logs: { args: { participant?: string } }[]) => {
    for (const log of logs) push("moved", log.args.participant!);
  }, [push]);

  const onMinted = useCallback((logs: { args: { participant?: string; entityId?: bigint } }[]) => {
    for (const log of logs) push("minted", log.args.participant!, `entity #${log.args.entityId}`);
  }, [push]);

  const onRegistered = useCallback((logs: { args: { participant?: string } }[]) => {
    for (const log of logs) push("entered", log.args.participant!);
  }, [push]);

  const onDeposited = useCallback((logs: { args: { participant?: string } }[]) => {
    for (const log of logs) push("deposited", log.args.participant!);
  }, [push]);

  const onEntityMoved = useCallback(
    (logs: { args: { entityId?: bigint } }[]) => {
      for (const log of logs) {
        const id = log.args.entityId;
        if (id === undefined) continue;
        // Entity events have no participant address; render via detail field.
        setEntries((prev) => [
          {
            id: nextId.current++,
            timestamp: ts(),
            type: "entity-moved",
            address: "",
            detail: `entity #${id}`,
          },
          ...prev,
        ].slice(0, MAX_ENTRIES));
      }
    },
    [],
  );

  useWatchTallGrassMovedEvent({ onLogs: onMoved });
  useWatchTallGrassMintedEvent({ onLogs: onMinted });
  useWatchTallGrassRegisteredEvent({ onLogs: onRegistered });
  useWatchTallGrassDepositedEvent({ onLogs: onDeposited });
  useWatchTallGrassEntityMovedEvent({ onLogs: onEntityMoved });

  return entries;
}
