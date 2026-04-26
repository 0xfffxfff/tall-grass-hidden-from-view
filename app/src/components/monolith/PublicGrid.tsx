import { useState } from "react";
import { Heatmap } from "./Heatmap";
import { Stream } from "./Stream";
import { TraitTabs } from "./TraitTabs";
import {
  recordToReveal,
  type LitByTrait,
  type Reveal,
  type RevealsByPair,
} from "./monolithLib";
import { useEntityCompare } from "@/hooks/useEntityCompare";
import { type RevealRecord } from "@/api";
import { WorkStrip } from "./WorkStrip";

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
  onEntitySelect?: (id: number) => void;
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
  onEntitySelect,
}: Props) {
  const [trait, setTrait] = useState(0);
  const { busyKeys, flashKey, error, fhe, runCompareOnPair } = useEntityCompare({
    prepend,
    litByTrait,
  });

  const litCount = litByTrait[trait]?.size ?? 0;
  const totalPairs = (entityCount * (entityCount - 1)) / 2;
  const streamRows: Reveal[] = flatReveals.slice(0, 12).map(recordToReveal);

  // The Stream and Drilldown row labels both navigate to the inline
  // drilldown by default, but if a modal opener was provided we route
  // entity-id clicks to the modal instead. Heatmap cells stay as
  // pair-comparisons regardless.
  const handleEntityNav = onEntitySelect ?? onDrillIdChange;

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
      {fhe.awaitingConsent && (
        <div className="public-consent" role="group" aria-label="cloud key download confirmation">
          <span className="pip" />
          <span className="label">first use downloads a ~78 MB homomorphic-encryption key to your browser</span>
          <button type="button" className="consent-action" onClick={fhe.grantConsent}>continue</button>
          <button type="button" className="consent-action ghost" onClick={fhe.cancelConsent}>cancel</button>
        </div>
      )}
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
        onEntityClick={handleEntityNav}
      />
    </main>
  );
}
