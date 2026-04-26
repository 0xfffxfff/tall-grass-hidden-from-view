import { TitleBar } from "./TitleBar";

export function WallText() {
  return (
    <section className="wall">
      <h1 className="title">Tall Grass (Hidden From View)</h1>
      <p className="byline">0xfff, 2026</p>
      <img src="/exhibit.jpg" alt="Tall Grass (Hidden From View)" className="exhibit-hero" />
      <TitleBar />
      <p>
        Tall Grass is a hidden landscape on Ethereum. Visitors enter and walk
        through it in darkness. The terrain is committed on-chain but never
        revealed; positions are stored as commitments, opaque to the chain and
        to other participants. Each move is a zero-knowledge proof &mdash; the
        contract knows the step was valid without learning where it happened.
        The chain enters the work as a load-bearing armature: not its surface,
        but the geometry that makes its form possible.
      </p>
      <p>
        Encounters happen in tall grass. A shrouded entity &mdash; a small
        hidden program &mdash; appears at the visitor&rsquo;s position; they
        may attempt to collect it. Each entity carries encrypted traits. Anyone
        can compare two entities homomorphically: the comparison returns
        greater, less, or equal; the underlying values stay sealed. Comparisons
        accumulate slowly, locally, through hours of browser computation.
      </p>
      <p>
        Visitors navigate but cannot see. Entities are compared but cannot be
        read. The Monolith moves but cannot be deciphered.
      </p>
    </section>
  );
}
