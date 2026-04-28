import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import { type Hex, parseEther } from "viem";
import {
  useReadTallGrassMintPrice,
  useWriteTallGrassMint,
} from "@/generated";
import { api, type EncounterData } from "@/api";
import { APP_CHAIN } from "@/chain";
import { fmtTime, pad2 } from "./monolithLib";
import { workBus } from "@/lib/workBus";
import { WorkStrip } from "./WorkStrip";

interface Props {
  apiToken: string | null;
  pendingEncounters: EncounterData[];
  onMinted: (entityId: number) => void;
}

interface RecordedEncounter extends EncounterData {
  ts: Date;
}

export function EncountersInline({
  apiToken,
  pendingEncounters,
  onMinted,
}: Props) {
  const { address } = useAccount();
  const [manual, setManual] = useState<RecordedEncounter[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const seenRef = useRef<Set<number>>(new Set());
  const [stamped, setStamped] = useState<RecordedEncounter[]>([]);

  // Stamp pending encounters with first-seen timestamps so they sort + display.
  useEffect(() => {
    const additions: RecordedEncounter[] = [];
    for (const e of pendingEncounters) {
      if (seenRef.current.has(e.entityId)) continue;
      seenRef.current.add(e.entityId);
      additions.push({ ...e, ts: new Date() });
    }
    if (additions.length) {
      setStamped((prev) => [...prev, ...additions]);
    }
  }, [pendingEncounters]);

  // Drop stamped entries that are no longer in pendingEncounters (minted or cleared).
  useEffect(() => {
    const ids = new Set(pendingEncounters.map((e) => e.entityId));
    setStamped((prev) => prev.filter((e) => ids.has(e.entityId)));
  }, [pendingEncounters]);

  const seen = new Set<number>();
  const all: RecordedEncounter[] = [];
  for (const e of [...stamped, ...manual]) {
    if (!seen.has(e.entityId)) {
      seen.add(e.entityId);
      all.push(e);
    }
  }
  all.sort((a, b) => b.ts.getTime() - a.ts.getTime());

  async function check() {
    if (!address || !apiToken) return;
    workBus.start({
      id: "encounter-check",
      scope: "walk",
      label: "checking for encounters at current position",
    });
    try {
      setChecking(true);
      setCheckError("");
      const res = await api.encounter(address, apiToken);
      if (res.valid && res.encounters?.length) {
        setManual((prev) => [
          ...prev,
          ...res.encounters!.map((e) => ({ ...e, ts: new Date() })),
        ]);
      } else {
        setCheckError("no entity at this position");
      }
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "check failed");
    } finally {
      setChecking(false);
      workBus.end("encounter-check");
    }
  }

  return (
    <section className="encounters">
      <h2>encounters</h2>
      {all.length > 0 ? (
        <p>
          {all.length === 1
            ? "An entity has crossed your path while walking."
            : `${all.length} entities have crossed your path while walking.`}{" "}
          Each can be minted; the underlying traits stay encrypted on chain.
        </p>
      ) : (
        <p>
          No encounters yet. Walk through the landscape until an entity crosses
          your path.{" "}
          <button
            className="aff live"
            onClick={check}
            disabled={checking}
            style={{ marginLeft: 6 }}
          >
            {checking ? "checking\u2026" : "check now"}
          </button>
        </p>
      )}
      {checkError && all.length === 0 && (
        <p className="why">{checkError}</p>
      )}
      {all.length > 0 && (
        <ul className="enc-list">
          {all.map((e) => (
            <EncounterRow
              key={e.entityId}
              encounter={e}
              onMinted={() => {
                seenRef.current.delete(e.entityId);
                setManual((prev) =>
                  prev.filter((m) => m.entityId !== e.entityId),
                );
                onMinted(e.entityId);
              }}
            />
          ))}
        </ul>
      )}
      <WorkStrip scope="walk" className="enc-work" />
    </section>
  );
}

function EncounterRow({
  encounter,
  onMinted,
}: {
  encounter: RecordedEncounter;
  onMinted: () => void;
}) {
  const { data: mintPrice } = useReadTallGrassMintPrice();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const {
    writeContract: mint,
    data: txHash,
    isPending: isSigning,
    error: mintError,
  } = useWriteTallGrassMint();
  const {
    isLoading: isConfirming,
    isSuccess,
    error: txError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const firedRef = useRef(false);
  useEffect(() => {
    if (isSuccess && !firedRef.current) {
      firedRef.current = true;
      workBus.end(`mint-${encounter.entityId}`);
      onMinted();
    }
  }, [isSuccess, onMinted, encounter.entityId]);

  useEffect(() => {
    const id = `mint-${encounter.entityId}`;
    if (isSigning) {
      workBus.update(id, `confirm mint of #${pad2(encounter.entityId)} in wallet`);
    } else if (isConfirming) {
      workBus.update(id, `waiting for chain confirmation (mint #${pad2(encounter.entityId)})`);
    } else if (mintError || txError) {
      workBus.end(id);
    }
  }, [isSigning, isConfirming, mintError, txError, encounter.entityId]);

  const busy = isSigning || isConfirming;
  const error = mintError || txError;

  async function doMint() {
    workBus.start({
      id: `mint-${encounter.entityId}`,
      scope: "walk",
      label: `confirm mint of #${pad2(encounter.entityId)} in wallet`,
    });
    if (walletChainId !== APP_CHAIN.id) {
      try {
        await switchChainAsync({ chainId: APP_CHAIN.id });
      } catch {
        workBus.end(`mint-${encounter.entityId}`);
        return;
      }
    }
    mint({
      args: [
        BigInt(encounter.entityId),
        encounter.encounterProof as Hex,
        encounter.entityTraitHash as Hex,
        encounter.initialPositionCommitment as Hex,
        encounter.blindingSeedCommitment as Hex,
        encounter.traitMerkleProof as Hex[],
      ],
      value: mintPrice ?? parseEther("0.2"),
    });
  }

  return (
    <li>
      <span className="ts">{fmtTime(encounter.ts)}</span>
      <img
        className="encounter-preview"
        src={`/previews/${encounter.entityId}.jpg`}
        alt={`Entity #${pad2(encounter.entityId)}`}
        loading="lazy"
        decoding="async"
      />
      <span className="id">#{pad2(encounter.entityId)}</span>
      <span className="where">pending</span>
      {isSuccess ? (
        <span style={{ color: "var(--fg-mid)" }}>minted</span>
      ) : (
        <button
          className={"aff" + (busy ? " busy" : " live")}
          onClick={doMint}
          disabled={busy}
        >
          {busy
            ? isSigning
              ? "confirm\u2026"
              : "minting\u2026"
            : "mint \u00b7 0.2 eth"}
        </button>
      )}
      {error && (
        <span style={{ color: "var(--fg-faint)", fontSize: 11 }}>
          {(error as Error).message.slice(0, 80)}
        </span>
      )}
    </li>
  );
}
