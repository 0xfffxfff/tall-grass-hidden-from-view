// Entity-detail modal. Opens over the page when a visitor selects an
// entity. Shows the 9:16 hero, a compact identity strip (id + owner +
// ciphertext hash), a 7-trait x N-other matrix where unrevealed cells
// trigger a homomorphic comparison on click, and a tail of recent reveals
// involving this entity.
//
// The compare flow is shared with PublicGrid via useEntityCompare. Owner
// is read on demand via wagmi's useReadContract; ciphertext hash is read
// from the metadata contract whose address lives behind the TallGrass
// `metadataContract()` getter.

import { useEffect, useMemo, useRef } from "react";
import { useReadContract } from "wagmi";
import { isAddress, type Address } from "viem";
import {
  pad2,
  pairKey,
  pairTraitKey,
  shortAddr,
  recordToReveal,
  type Op,
  type RevealsByPair,
} from "./monolithLib";
import { useEntityCompare } from "@/hooks/useEntityCompare";
import { useTokens } from "@/hooks/useTokens";
import { WorkStrip } from "./WorkStrip";
import { useReadTallGrassMetadataContract } from "@/generated";
import { type RevealRecord } from "@/api";

// Entity #00 is the artist's proof — always treated as revealed even
// before the on-chain mint, with a hardcoded owner label.
const ARTIST_PROOF_ID = 0;
const ARTIST_PROOF_OWNER_LABEL = "0xfff.eth";

// Hero zoom for the embedded /full route. Matches the per-aspect zoom
// used by the on-chain preview render script for 9:16 (so the hero
// reads at the same framing as the static JPG fallback below it).
const HERO_ZOOM = 1.15;

interface Props {
  entityId: number | null;
  entityCount: number;
  traitCount: number;
  reveals: RevealsByPair;
  flatReveals: RevealRecord[];
  prepend: (rec: RevealRecord) => void;
  onClose: () => void;
}

// Inline ABI fragment for the metadata contract's ciphertextHash view.
// The wagmi codegen config only includes TallGrass; rather than churning
// the generator, we read this one function inline — it's a single tiny
// view call.
const ciphertextHashAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "ciphertextHash",
    inputs: [{ name: "entityId", internalType: "uint256", type: "uint256" }],
    outputs: [{ name: "", internalType: "bytes32", type: "bytes32" }],
  },
] as const;

export function EntityModal({
  entityId,
  entityCount,
  traitCount,
  reveals,
  flatReveals,
  prepend,
  onClose,
}: Props) {
  const open = entityId !== null;

  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // ESC closes; body scroll lock; focus the close button.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    // Focus the close button on next tick so it's reachable for keyboard
    // users; nice-to-have, not essential.
    const t = setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, onClose]);

  // Compare flow — same hook PublicGrid uses. Note: the consent prompt
  // (when the cloud key still needs to be downloaded) renders inside the
  // pane-data head; the modal sits on top of the page so a prompt under
  // the backdrop wouldn't be reachable.
  const { busyKeys, flashKey, error, fhe, runCompareOnPair } = useEntityCompare(
    { prepend },
  );

  // Token state — owner + minted flag come from the canonical
  // allTokenStates read (deduped by wagmi cache with EntityRegistry's
  // call). We use this rather than ownerOf because ownerOf reverts for
  // unminted ids, and we want to render the modal regardless.
  const { tokens } = useTokens();
  const token = entityId !== null ? tokens[entityId] : undefined;
  const isArtistProof = entityId === ARTIST_PROOF_ID;
  const revealed = isArtistProof || !!token?.minted;

  // Metadata contract address (one chain read, cached by wagmi). Used as
  // the target for the ciphertext-hash read below.
  const metadataAddrRead = useReadTallGrassMetadataContract({
    query: { enabled: open },
  });
  const metadataAddr = metadataAddrRead.data as Address | undefined;
  const metadataAddrUsable =
    metadataAddr && isAddress(metadataAddr) ? metadataAddr : undefined;

  const ciphertextHashRead = useReadContract({
    address: metadataAddrUsable,
    abi: ciphertextHashAbi,
    functionName: "ciphertextHash",
    args: entityId !== null ? [BigInt(entityId)] : undefined,
    query: { enabled: open && !!metadataAddrUsable },
  });

  const ownerLabel = (() => {
    if (isArtistProof) return ARTIST_PROOF_OWNER_LABEL;
    if (!revealed) return "to be revealed";
    if (!token?.owner) return "\u2014";
    return shortAddr(token.owner);
  })();

  const ciphertextLabel = (() => {
    const data = ciphertextHashRead.data as string | undefined;
    if (!data) return "\u2014";
    if (data.length < 12) return data;
    return data.slice(0, 6) + "\u2026" + data.slice(-4);
  })();

  // Matrix — for each trait t, an array of length entityCount where
  // index = other entity id; value = Op | null.
  const matrix = useMemo(() => {
    if (entityId === null) return null;
    const rows: (Op | null)[][] = [];
    const traitCountPerOther = new Array(entityCount).fill(0);
    const traitRevealCount = new Array(traitCount).fill(0);
    for (let t = 0; t < traitCount; t++) {
      const row: (Op | null)[] = new Array(entityCount).fill(null);
      for (let other = 0; other < entityCount; other++) {
        if (other === entityId) continue;
        const rec = reveals[pairKey(entityId, other)]?.[t];
        if (rec) {
          row[other] = rec.op;
          traitCountPerOther[other]++;
          traitRevealCount[t]++;
        }
      }
      rows.push(row);
    }
    return { rows, traitCountPerOther, traitRevealCount };
  }, [entityId, entityCount, traitCount, reveals]);

  // Recent reveals involving this entity — flat list filtered, sorted
  // desc by ts (already sorted by useReveals), sliced 9.
  const recentRows = useMemo(() => {
    if (entityId === null) return [];
    return flatReveals
      .filter((r) => r.a === entityId || r.b === entityId)
      .slice(0, 9)
      .map(recordToReveal);
  }, [entityId, flatReveals]);

  if (!open || entityId === null || matrix === null) return null;

  const totalRevealedForEntity = matrix.traitRevealCount.reduce(
    (a, b) => a + b,
    0,
  );
  const totalSlots = traitCount * (entityCount - 1);
  // Other-id columns (skip self).
  const cols: number[] = [];
  for (let i = 0; i < entityCount; i++) {
    if (i !== entityId) cols.push(i);
  }

  return (
    <div className="entity-modal-root">
      <div
        className="entity-modal-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="entity-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Entity #${pad2(entityId)} detail`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pane-image">
          <div className="hero" aria-hidden="true">
            {revealed ? (
              <>
                {/* Static JPG renders immediately and stays as a fallback
                    for the iframe (slow networks, sandbox failures, etc).
                    The iframe paints over it once /full has booted up. */}
                <img
                  className="hero-still"
                  src={`/previews/${entityId}.jpg`}
                  alt=""
                  loading="eager"
                  decoding="async"
                />
                <iframe
                  className="hero-frame"
                  src={`/full?id=${entityId}&zoom=${HERO_ZOOM}`}
                  title={`entity #${pad2(entityId)} live render`}
                  loading="eager"
                  sandbox="allow-scripts allow-same-origin"
                />
              </>
            ) : (
              <span className="hero-veil" aria-hidden="true" />
            )}
          </div>
          <div className="id-strip">
            <div className="row">
              <span className="k">id</span>
              <span className="v">#{pad2(entityId)}</span>
            </div>
            <div className="row">
              <span className="k">owner</span>
              <span className="v thin">{ownerLabel}</span>
            </div>
            {revealed && (
              <div className="row">
                <span className="k">ciphertext</span>
                <span className="v thin hash">{ciphertextLabel}</span>
              </div>
            )}
          </div>
        </div>

        <div className="pane-data">
          <div className="head">
            <h1>
              entity <span className="num">#{pad2(entityId)}</span>
              <span className="sub">
                {totalRevealedForEntity} of {totalSlots} traits compared
              </span>
            </h1>
            <button
              type="button"
              ref={closeBtnRef}
              className="close"
              aria-label="close"
              onClick={onClose}
            >
              {"close \u00D7"}
            </button>
          </div>

          <p className="ambient">
            Each cell is a relation between this entity and another &mdash;
            greater, less, or equal &mdash; never a value. Click any
            &middot; to add to the public record.
          </p>

          {/* WorkStrip is suppressed while the consent prompt is up — its
              "waiting for confirmation" label would just duplicate what
              the prompt already says, in the row immediately below. */}
          {!fhe.awaitingConsent && (
            <WorkStrip scope="public" className="modal-work" />
          )}
          {fhe.awaitingConsent && (
            <div
              className="modal-consent"
              role="group"
              aria-label="cloud key download confirmation"
            >
              <div className="line">
                <span className="pip" />
                <span className="label">
                  first use downloads a ~78 MB homomorphic-encryption key to
                  your browser
                </span>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="consent-action"
                  onClick={fhe.grantConsent}
                >
                  continue
                </button>
                <button
                  type="button"
                  className="consent-action ghost"
                  onClick={fhe.cancelConsent}
                >
                  cancel
                </button>
              </div>
            </div>
          )}
          {fhe.status === "error" && fhe.message && (
            <div className="modal-error">{fhe.message}</div>
          )}
          {error && <div className="modal-error">{error}</div>}

          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th>trait \ vs</th>
                  {cols.map((other) => {
                    const full =
                      matrix.traitCountPerOther[other] === traitCount
                        ? " col-full"
                        : "";
                    return (
                      <th
                        key={other}
                        className={"col" + full}
                        title={`vs #${pad2(other)}${full ? " · fully compared" : ""}`}
                      >
                        {pad2(other)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row, t) => (
                  <tr key={t}>
                    <th>
                      trait {t}
                      <span className="ratio">
                        {matrix.traitRevealCount[t]}/{entityCount - 1}
                      </span>
                    </th>
                    {cols.map((other) => {
                      const op = row[other];
                      const cellKey = pairTraitKey(entityId, other, t);
                      const isBusy = busyKeys.has(cellKey);
                      const isFlash = flashKey === cellKey;
                      let cls = "cell";
                      if (op) cls += " r";
                      if (isBusy) cls += " busy";
                      if (isFlash) cls += " flash";
                      return (
                        <td
                          key={other}
                          className={cls}
                          onClick={() => {
                            if (op) return;
                            runCompareOnPair(
                              Math.min(entityId, other),
                              Math.max(entityId, other),
                              t,
                            );
                          }}
                        >
                          {op === ">"
                            ? ">"
                            : op === "<"
                              ? "<"
                              : op === "="
                                ? "="
                                : "\u00B7"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stream-strip">
            <div className="lab">recent reveals involving #{pad2(entityId)}</div>
            {recentRows.length === 0 ? (
              <div className="row empty">no reveals yet</div>
            ) : (
              recentRows.map((r) => {
                const tsLabel = formatRelative(Date.now() - r.ts.getTime());
                return (
                  <div
                    key={`${r.ts.getTime()}_${r.a}_${r.b}_${r.trait}`}
                    className="row"
                  >
                    <span className="ts">{tsLabel}</span>
                    <span className="a">#{pad2(r.a)}</span>
                    <span className="op">{r.op}</span>
                    <span className="b">#{pad2(r.b)}</span>
                    <span className="tr">trait {r.trait}</span>
                    <span className="by">
                      {r.by && r.by !== "anon" ? `by ${r.by}` : ""}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="foot">
            click an unrevealed &middot; to trigger a homomorphic comparison
            &middot; ~2.7s per pair
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRelative(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}
