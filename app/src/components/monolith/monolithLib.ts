// Utilities + types shared by Heatmap, Stream, Drilldown, PublicGrid.

import type { RevealRecord } from "@/api";

export type Op = ">" | "<" | "=";
export const OPS: Op[] = [">", "<", "="];

export interface Reveal {
  op: Op;
  ts: Date;
  by: string;
  trait: number;
  a: number;
  b: number;
  note?: string;
}

export type RevealsByPair = Record<string, Record<number, Reveal>>;
export type LitByTrait = Record<number, Set<string>>;

export function recordToReveal(rec: RevealRecord): Reveal {
  return {
    a: rec.a,
    b: rec.b,
    op: rec.op as Op,
    trait: rec.trait,
    ts: new Date(rec.revealedAt),
    // Keep the full address — display sites short it themselves (and wrap
    // it in an explorer link), title attributes show it raw on hover.
    by: rec.revealer,
  };
}

export function projectReveals(
  records: RevealRecord[],
  traitCount: number,
): { revealsByPair: RevealsByPair; litByTrait: LitByTrait } {
  const byPair: RevealsByPair = {};
  const lit: LitByTrait = {};
  for (let t = 0; t < traitCount; t++) lit[t] = new Set();
  for (const r of records) {
    const key = pairKey(r.a, r.b);
    const reveal = recordToReveal(r);
    const slot = byPair[key] ?? (byPair[key] = {});
    const existing = slot[r.trait];
    if (!existing || existing.ts.getTime() < reveal.ts.getTime()) {
      slot[r.trait] = reveal;
    }
    lit[r.trait]?.add(key);
  }
  return { revealsByPair: byPair, litByTrait: lit };
}

export function pairKey(a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}_${hi}`;
}

// Per-(pair, trait) key for busy/flash state. The matrix in EntityModal
// shows all 7 traits per pair simultaneously, so a pair-only key would
// glow the entire column when one cell is clicked. Including the trait
// disambiguates which specific cell is in flight.
export function pairTraitKey(a: number, b: number, t: number): string {
  return `${pairKey(a, b)}_${t}`;
}

export function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

export function fmtId(n: number): string {
  return "#" + pad2(n);
}

export function fmtTime(d: Date): string {
  return (
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds())
  );
}

export function shortAddr(addr: string): string {
  if (!addr || addr === "anon") return "anon";
  if (addr.length < 10) return addr;
  return addr.slice(0, 5) + "\u2026" + addr.slice(-4);
}
