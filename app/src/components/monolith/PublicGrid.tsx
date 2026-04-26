import { useState } from "react";
import { useAccount } from "wagmi";
import { Heatmap } from "./Heatmap";
import { Stream } from "./Stream";
import { Drilldown } from "./Drilldown";
import { TraitTabs } from "./TraitTabs";
import {
  pairKey,
  recordToReveal,
  type LitByTrait,
  type Reveal,
  type RevealsByPair,
} from "./monolithLib";
import { useFhe } from "@/hooks/useFhe";
import { api, type RevealRecord } from "@/api";
import { WorkStrip } from "./WorkStrip";
import { workBus } from "@/lib/workBus";

interface Props {
  entityCount: number;
  traitCount: number;
  revealsByPair: RevealsByPair;
  litByTrait: LitByTrait;
  flatReveals: RevealRecord[];
  loading: boolean;
  prepend: (rec: RevealRecord) => void;
  drillId: number | null;
  onDrillIdChange: (id: number) => void;
}

export function PublicGrid({
  entityCount,
  traitCount,
  revealsByPair,
  litByTrait,
  flatReveals,
  loading,
  prepend,
  drillId,
  onDrillIdChange,
}: Props) {
  const { address } = useAccount();
  const fhe = useFhe();

  const [trait, setTrait] = useState(0);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const litCount = litByTrait[trait]?.size ?? 0;
  const totalPairs = (entityCount * (entityCount - 1)) / 2;
  const streamRows: Reveal[] = flatReveals.slice(0, 12).map(recordToReveal);

  async function runCompareOnPair(a: number, b: number, t: number) {
    const key = pairKey(a, b);
    if (busyKeys.has(key)) return;
    if (litByTrait[t]?.has(key)) return;
    setError("");
    setBusyKeys((prev) => new Set(prev).add(key));
    const decryptId = `oracle-decrypt-${key}-${t}`;
    try {
      if (t !== trait) setTrait(t);
      // Lazy-load wasm + cloud key on first compare; subsequent calls are fast.
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
  }

  return (
    <main className="public">
      <p className="ambient">
        This is the public record of every comparison ever made between two
        entities. Each cell is a relation &mdash; greater, less, or equal
        &mdash; never a value. Comparisons run homomorphically in your
        browser; the oracle decrypts only the boolean result and returns a
        proof that the decryption was correct. Click any unrevealed cell to
        add to the record.
      </p>

      <div className="status">
        <div className="left">
          <span className="label-mid">trait</span>
          <TraitTabs count={traitCount} selected={trait} onSelect={setTrait} />
        </div>
        <div className="right">
          <span>
            {litCount} of {totalPairs.toLocaleString()} revealed
          </span>
          <span className="live">
            <span className="pip" />
            {loading ? "loading" : "live"}
          </span>
        </div>
      </div>

      <WorkStrip scope="public" className="public-work" />
      {fhe.status === "error" && fhe.message && (
        <div className="public-error">{fhe.message}</div>
      )}

      <Heatmap
        trait={trait}
        entityCount={entityCount}
        reveals={revealsByPair}
        lit={litByTrait}
        busyKeys={busyKeys}
        flashKey={flashKey}
        onCellClick={(a, b) => runCompareOnPair(a, b, trait)}
      />

      {error && (
        <div
          style={{
            color: "var(--fg-mid)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            margin: "0 0 16px",
          }}
        >
          {error}
        </div>
      )}

      <Stream
        rows={streamRows}
        enteringIds={new Set()}
        onEntityClick={onDrillIdChange}
      />

      {drillId !== null && (
        <Drilldown
          entityId={drillId}
          entityCount={entityCount}
          traitCount={traitCount}
          reveals={revealsByPair}
          onSelectEntity={onDrillIdChange}
          onCellClick={runCompareOnPair}
        />
      )}
    </main>
  );
}
