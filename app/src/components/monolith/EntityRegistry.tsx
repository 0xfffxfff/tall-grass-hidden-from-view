import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { type Hex } from "viem";
import { hardhat } from "wagmi/chains";
import {
  tallGrassAbi,
  tallGrassAddress,
  useWatchTallGrassMintedEvent,
  useWatchTallGrassTransferEvent,
} from "@/generated";
import { pad2, shortAddr } from "./monolithLib";

interface Props {
  entityCount: number;
  onSelectEntity: (id: number) => void;
}

const TG_ADDR = tallGrassAddress[hardhat.id] as Hex;

type Mode = "all" | "mine";

export function EntityRegistry({ entityCount, onSelectEntity }: Props) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [owners, setOwners] = useState<(string | null)[]>([]);
  const [scanning, setScanning] = useState(true);
  const [mode, setMode] = useState<Mode>("all");

  const me = address?.toLowerCase();

  const scan = useCallback(async () => {
    if (!publicClient || entityCount === 0) {
      setOwners([]);
      setScanning(false);
      return;
    }
    const results = await Promise.allSettled(
      Array.from({ length: entityCount }, (_, i) =>
        publicClient.readContract({
          abi: tallGrassAbi,
          address: TG_ADDR,
          functionName: "ownerOf",
          args: [BigInt(i)],
        }),
      ),
    );
    const next: (string | null)[] = results.map((r) =>
      r.status === "fulfilled" && typeof r.value === "string" ? r.value : null,
    );
    setOwners(next);
    setScanning(false);
  }, [publicClient, entityCount]);

  useEffect(() => {
    setScanning(true);
    scan();
  }, [scan]);

  // Refetch on chain events that change ownership.
  useWatchTallGrassMintedEvent({ onLogs: () => scan() });
  useWatchTallGrassTransferEvent({ onLogs: () => scan() });

  const mintedCount = owners.filter((o) => o !== null).length;

  const rows = useMemo(() => {
    const out: { id: number; owner: string | null; mine: boolean }[] = [];
    for (let id = 0; id < entityCount; id++) {
      const owner = owners[id] ?? null;
      const mine = !!owner && !!me && owner.toLowerCase() === me;
      if (mode === "mine" && !mine) continue;
      out.push({ id, owner, mine });
    }
    return out;
  }, [owners, entityCount, mode, me]);

  return (
    <section className="registry">
      <h2>entities</h2>
      <p>
        Every entity in the landscape, and who holds it. Unminted entities
        remain hidden until a visitor encounters them.
      </p>

      <div className="registry-bar">
        <span className="registry-count">
          {mintedCount} of {entityCount} minted
        </span>
        <span className="registry-modes">
          <button
            className={"mode" + (mode === "all" ? " on" : "")}
            onClick={() => setMode("all")}
            aria-pressed={mode === "all"}
          >
            all
          </button>
          {isConnected && (
            <button
              className={"mode" + (mode === "mine" ? " on" : "")}
              onClick={() => setMode("mine")}
              aria-pressed={mode === "mine"}
            >
              mine
            </button>
          )}
        </span>
      </div>

      {scanning && owners.length === 0 ? (
        <p className="why">scanning landscape&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="why">
          {mode === "mine"
            ? "You hold no entities yet."
            : "No entities have been minted yet."}
        </p>
      ) : (
        <ul className="registry-list">
          {rows.map(({ id, owner, mine }) => (
            <li key={id} className={owner ? "minted" : "unminted"}>
              <button
                className="entity-id"
                onClick={() => onSelectEntity(id)}
                title="open in drilldown"
              >
                #{pad2(id)}
              </button>
              {owner ? (
                <>
                  <span className="owner">{shortAddr(owner)}</span>
                  {mine && <span className="me">(you)</span>}
                </>
              ) : (
                <span className="owner-empty">in the landscape</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
