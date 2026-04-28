import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useTokens } from "@/hooks/useTokens";
import { pad2, shortAddr } from "./monolithLib";

interface Props {
  entityCount: number;
  // Entity ids the connected wallet has personally encountered (walked
  // onto a cell holding them). Ciphertext stays sealed; the JPEG
  // preview becomes visible in this viewer only — the public mint state
  // is unchanged.
  personallyVisible: Set<number>;
  onSelectEntity: (id: number) => void;
}

// Entity #0 is reserved as the artist's proof and stays visible from day one.
// Owner label is hardcoded — even if the chain shows a different address (e.g.
// during local dev before artistMint runs), the canonical credit is 0xfff.eth.
const ARTIST_PROOF_ID = 0;
const ARTIST_PROOF_OWNER_LABEL = "0xfff.eth";

type Mode = "all" | "mine";

export function EntityRegistry({
  entityCount,
  personallyVisible,
  onSelectEntity,
}: Props) {
  const { address, isConnected } = useAccount();
  const { tokens, loading } = useTokens();
  const [mode, setMode] = useState<Mode>("all");

  const me = address?.toLowerCase();

  // Always iterate the full 0..entityCount-1 range so the grid shows
  // every entity regardless of mint state. Unminted ids get a veiled
  // tile and a "to be revealed" owner label. The token map is keyed by
  // id; missing ids fall through to defaults.
  const tokenById = useMemo(() => {
    const m = new Map<number, (typeof tokens)[number]>();
    for (const t of tokens) m.set(t.id, t);
    return m;
  }, [tokens]);

  const tiles = useMemo(() => {
    const out: {
      id: number;
      owner: string | null;
      mine: boolean;
      revealed: boolean;
      privateOnly: boolean;
      ownerLabel: string | null;
    }[] = [];
    for (let id = 0; id < entityCount; id++) {
      const t = tokenById.get(id);
      const owner = t?.owner ?? null;
      const minted = !!t?.minted;
      const mine = !!owner && !!me && owner.toLowerCase() === me;
      const isArtistProof = id === ARTIST_PROOF_ID;
      const personally = personallyVisible.has(id);
      const revealed = isArtistProof || minted || personally;
      const privateOnly = personally && !minted && !isArtistProof;
      const ownerLabel = isArtistProof
        ? ARTIST_PROOF_OWNER_LABEL
        : owner
          ? shortAddr(owner)
          : privateOnly
            ? "encountered \u00b7 not minted"
            : null;
      if (mode === "mine" && !mine) continue;
      out.push({ id, owner, mine, revealed, privateOnly, ownerLabel });
    }
    return out;
  }, [tokenById, entityCount, mode, me, personallyVisible]);

  const mintedCount = tokens.filter((t) => t.minted).length;

  return (
    <section className="registry">
      <h2>entities</h2>
      <p>
        Thirty-two entities live in the landscape. Each stays hidden in the
        public registry until a visitor encounters and mints it &mdash; only
        then does its likeness appear to everyone. Entities you have personally
        encountered surface in your view as soon as you walk into them, even
        before you decide to mint. Entity #00 is the artist&rsquo;s proof,
        kept by the artist.
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

      {tiles.length === 0 ? (
        <p className="why">
          {mode === "mine"
            ? "You hold no entities yet."
            : loading
              ? "scanning landscape\u2026"
              : "No entities yet."}
        </p>
      ) : (
        <ul className="registry-grid">
          {tiles.map(({ id, mine, revealed, privateOnly, ownerLabel }) => {
            const isArtistProof = id === ARTIST_PROOF_ID;
            return (
              <li
                key={id}
                className={
                  "tile" +
                  (revealed ? " revealed" : " veiled") +
                  (mine ? " mine" : "") +
                  (isArtistProof ? " artist-proof" : "") +
                  (privateOnly ? " private" : "")
                }
              >
                <button
                  className="tile-button"
                  onClick={() => onSelectEntity(id)}
                  title={
                    revealed
                      ? `open Entity #${pad2(id)}`
                      : `Entity #${pad2(id)} — to be revealed`
                  }
                >
                  <span className="tile-image">
                    {revealed ? (
                      <img
                        src={`/previews/${id}.jpg`}
                        alt={`Entity #${pad2(id)}`}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="tile-veil" aria-hidden="true" />
                    )}
                  </span>
                  <span className="tile-meta">
                    <span className="tile-id">#{pad2(id)}</span>
                    <span className="tile-owner">
                      {ownerLabel ?? "to be revealed"}
                      {mine && <span className="me"> (you)</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
