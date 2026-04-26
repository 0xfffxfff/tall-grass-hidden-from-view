import type { ActivityEntry } from "@/hooks/useActivity";

const SEED_ENTRIES = [
  "14:22:07  #41 > #07  trait 3  revealed by 0x4a2…f81c",
  "14:21:54  #29 = #14  trait 1  revealed by 0xc1d…e556",
  "14:03:22  0x4a2…f81c moved",
  "14:21:32  #03 < #41  trait 5",
  "14:03:18  entity #19 minted by 0x9b3…7a02",
  "14:21:11  #22 > #07  trait 3  revealed by 0x4a2…f81c",
  "14:02:55  0xc1d…e556 entered the landscape",
  "14:20:48  #14 < #41  trait 0  revealed by 0x9b3…7a02",
  "14:02:31  0x4a2…f81c moved",
  "14:20:19  #07 = #19  trait 6  revealed by 0x77e…a019",
  "14:02:14  entity #28 moved",
  "14:19:55  #41 > #29  trait 2",
  "14:01:58  0x77e…a019 moved",
  "14:19:30  #14 > #03  trait 3  revealed by 0xc1d…e556",
  "14:01:22  entity #03 minted by 0x21f…b8d4",
  "14:19:02  #22 = #29  trait 4  revealed by 0x4a2…f81c",
  "14:01:02  0xc1d…e556 moved",
  "14:18:38  #07 < #11  trait 1  revealed by 0x21f…b8d4",
  "14:00:47  entity #11 moved",
  "14:18:11  #29 > #07  trait 5",
  "14:00:31  0x9b3…7a02 moved",
  "14:17:42  #41 = #03  trait 0  revealed by 0x9b3…7a02",
  "14:00:08  0x4a2…f81c moved",
  "13:58:02  entity #22 minted by 0x4a2…f81c",
];

function liveEntryText(e: ActivityEntry): string {
  const ts = e.timestamp;
  switch (e.type) {
    case "moved":
      return `${ts}  ${e.address} moved`;
    case "entered":
      return `${ts}  ${e.address} entered the landscape`;
    case "minted":
      return `${ts}  ${e.detail ?? "entity"} minted by ${e.address}`;
    case "deposited":
      return `${ts}  ${e.address} deposited`;
    case "entity-moved":
      return `${ts}  ${e.detail ?? "entity"} moved`;
    default:
      return `${ts}  ${e.address} ${e.type}`;
  }
}

interface RevealLite {
  a: number;
  b: number;
  trait: number;
  op: ">" | "<" | "=";
  revealedAt: number;
  revealer: string;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}
function fmtTs(ms: number): string {
  const d = new Date(ms);
  return (
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds())
  );
}
function shortRevealer(addr: string): string {
  if (!addr || addr === "anon") return "anon";
  if (addr.length < 10) return addr;
  return addr.slice(0, 5) + "\u2026" + addr.slice(-4);
}
function revealText(r: RevealLite): string {
  return `${fmtTs(r.revealedAt)}  #${pad2(r.a)} ${r.op} #${pad2(r.b)}  trait ${r.trait}  revealed by ${shortRevealer(r.revealer)}`;
}

interface Props {
  entries?: ActivityEntry[];
  reveals?: RevealLite[];
}

export function Ticker({ entries = [], reveals = [] }: Props) {
  const live = entries.slice(0, 8).map(liveEntryText);
  const liveReveals = reveals.slice(0, 8).map(revealText);
  // Interleave reveals with chain-event entries so the ticker reads as a
  // single timeline regardless of source.
  const allLive = [...live, ...liveReveals];
  const items = allLive.length > 0 ? [...allLive, ...SEED_ENTRIES] : SEED_ENTRIES;
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {items.map((text, i) => (
          <span key={i}>
            {text}
            {i < items.length - 1 && (
              <span className="dim">&nbsp;&middot;&nbsp;</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
