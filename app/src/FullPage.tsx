import { useEffect } from "react";
import { usePublicClient } from "wagmi";
import { Stage } from "@/components/monolith/Stage";
import {
  useWatchTallGrassMovedEvent,
  useWatchTallGrassMintedEvent,
  useWatchTallGrassEntityMovedEvent,
  tallGrassAbi,
  tallGrassAddress,
} from "@/generated";
import { APP_CHAIN } from "@/chain";
import {
  ENTITY_COUNT,
  markMinted,
  pulseEntity,
  pushSweep,
  reactiveState,
  setPair,
} from "@/components/monolith/reactiveQueue";
import { api, type RevealRecord } from "@/api";

// Full-viewport monolith shader. This is what runs on the Monolith — two
// 9:16 portrait screens back-to-back. The field's kinetic events are
// derived from ciphertext bytes, pair commitments, and move slots, then
// advanced from a wall-time-anchored clock so the two screens stay in
// lockstep without any network coordination. Zoom 1.4 sits a hair below
// the v24 1.55 default — keeps the slabs framed without compressing the
// field as tightly at the edges.
//
// With entityId set (e.g. /full?id=5), Stage drops into single-entity
// locked mode: only that entity's slab renders, camera-followed so it
// stays centered while the haze drifts past. This is the per-entity
// NFT depiction — same shader code path, same atmospheric finish; what
// changes is that the field is reduced to one signature.
//
// The chain reactivity overlay is always on: live Moved / Minted /
// EntityMoved contract events and oracle reveals are pushed into
// reactiveQueue as additive layers over the synthetic field. RPC failures
// degrade gracefully (boot replay retries once after 30s, live watchers
// rotate across fallback transports, the shader keeps running off the
// last-known singleton state).
//
// Hotkeys for screen-test:
//   m  trigger a synthetic Moved sweep
//   n  trigger a Minted (cycles through unminted entityIds)
//   e  trigger an EntityMoved pulse on a random already-minted entity
//   c  trigger a Compare pair on two random minted entities
interface FullPageProps {
  entityId?: number;
  zoom?: number;
  // ?mirror=1: scaleX(-1) on the canvas for the second of two back-to-back
  // gallery screens, so world directions read consistently as you walk
  // around the sculpture. offsetX/offsetY are CSS pixels of camera shift,
  // converted to world units in Stage using the current dpr/zoom.
  mirror?: boolean;
  offsetX?: number;
  offsetY?: number;
}

// Sepolia public RPCs may reject very old fromBlock ranges. We pull a
// bounded recent window on boot — enough to capture all mints since the
// contract is brand-new. If the contract has been live longer than this
// window for a future deployment, raise the cap.
const HISTORY_BLOCK_WINDOW = 200_000n;

export function FullPage({
  entityId,
  zoom = 1.4,
  mirror = false,
  offsetX = 0,
  offsetY = 0,
}: FullPageProps) {
  useEffect(() => {
    document.body.classList.add("full-mode");
    if (mirror) document.body.classList.add("mirror-mode");
    return () => {
      document.body.classList.remove("full-mode");
      document.body.classList.remove("mirror-mode");
    };
  }, [mirror]);

  // ---- chain reactivity wiring (always on) ----

  const publicClient = usePublicClient();
  const contractAddr =
    tallGrassAddress[APP_CHAIN.id as keyof typeof tallGrassAddress];

  // Boot replay — mark mintedAt for every Minted event the contract has
  // emitted in the recent history window. Past Moved / EntityMoved / reveal
  // events are intentionally skipped: their visuals are transient and
  // replaying them on boot would lie about *when* they happened. The
  // persistent kinematic signature claim is per-entity (mintedAt).
  //
  // RPC failures (429, IP ban, dead node) are tolerated: the call is
  // wrapped in try/catch and will retry once after 30s on failure. After
  // that we give up silently and live subscriptions still try.
  useEffect(() => {
    if (!publicClient || !contractAddr) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    async function attempt(label: string): Promise<boolean> {
      try {
        const latestBlock = await publicClient!.getBlockNumber();
        const fromBlock =
          latestBlock > HISTORY_BLOCK_WINDOW
            ? latestBlock - HISTORY_BLOCK_WINDOW
            : 0n;
        console.log(
          `[reactive] boot replay (${label}): fetching Minted logs from block ${fromBlock} to ${latestBlock}`,
        );
        const mintedAbi = tallGrassAbi.find(
          (item) => item.type === "event" && item.name === "Minted",
        );
        if (!mintedAbi) {
          console.warn("[reactive] Minted event ABI not found");
          return true;
        }
        const logs = await publicClient!.getLogs({
          address: contractAddr,
          event: mintedAbi as never,
          fromBlock,
          toBlock: latestBlock,
        });
        if (cancelled) return true;
        console.log(
          `[reactive] boot replay (${label}): ${logs.length} Minted events found`,
        );
        // Boot-replayed mints already happened in the past, so stamp them
        // with a far-past birth time. The shader's 4s fade-in smoothstep
        // is already at 1.0, and the slabs render at full visibility from
        // frame zero.
        const farPast = -1e6;
        for (const log of logs) {
          const args = (log as unknown as { args?: { entityId?: bigint } }).args;
          const id = args?.entityId;
          if (id !== undefined) markMinted(Number(id), farPast);
        }
        return true;
      } catch (err) {
        console.warn(`[reactive] boot replay (${label}) failed:`, err);
        return false;
      }
    }
    (async () => {
      const ok = await attempt("first");
      if (ok || cancelled) return;
      // One-shot retry after 30s. If both attempts fail, we give up.
      // Live subscriptions keep working regardless.
      retryTimer = setTimeout(() => {
        if (cancelled) return;
        attempt("retry");
      }, 30_000);
    })();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [publicClient, contractAddr]);

  // Live Moved → push extra sweep, parameters seeded from the txHash so
  // each sweep looks distinct without depending on private direction info.
  useWatchTallGrassMovedEvent({
    onLogs: (logs) => {
      for (const log of logs) {
        const seed = log.transactionHash ?? log.blockHash ?? "";
        const axis = parseInt(seed.slice(2, 4) || "0", 16) % 2;
        const dir = parseInt(seed.slice(4, 6) || "0", 16) % 2 === 0 ? -1 : 1;
        pushSweep(reactiveState.shaderTime, axis, dir);
        console.log(
          `[reactive] chain Moved → sweep participant=${log.args.participant} tx=${seed.slice(0, 10)}`,
        );
      }
    },
  });

  // Live Minted → set mintedAt for that entityId. It becomes a permanent
  // slab in the field from this moment on, fading in over ~4s.
  useWatchTallGrassMintedEvent({
    onLogs: (logs) => {
      for (const log of logs) {
        const id = log.args.entityId;
        if (id === undefined) continue;
        markMinted(Number(id), reactiveState.shaderTime);
        console.log(
          `[reactive] chain Minted → entity=#${id} participant=${log.args.participant}`,
        );
      }
    },
  });

  // Live EntityMoved → brief pulse on that entity's persistent slab.
  useWatchTallGrassEntityMovedEvent({
    onLogs: (logs) => {
      for (const log of logs) {
        const id = log.args.entityId;
        if (id === undefined) continue;
        pulseEntity(Number(id), reactiveState.shaderTime);
        console.log(`[reactive] chain EntityMoved → pulse entity=#${id}`);
      }
    },
  });

  // Live oracle reveals are not on-chain events — they live in the oracle's
  // /api/reveals endpoint. Poll here, and when a new reveal arrives push
  // it as a real comparison pair (replaces the current pair so the latest
  // reveal always wins the overlay slot).
  useEffect(() => {
    let cancelled = false;
    let lastSeen = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick(initial: boolean) {
      try {
        const data = await api.reveals(initial ? 0 : lastSeen);
        if (cancelled) return;
        // On boot we just want to track the high-water mark, not flood
        // the screen with every historical pair.
        const newest = data.reveals.reduce<RevealRecord | null>(
          (acc, r) => (acc && acc.revealedAt >= r.revealedAt ? acc : r),
          null,
        );
        if (newest && newest.revealedAt > lastSeen) {
          lastSeen = newest.revealedAt;
          if (!initial) {
            const greaterIsB = newest.op === ">" ? 0 : newest.op === "<" ? 1 : 0;
            setPair({
              birthTime: reactiveState.shaderTime,
              a: newest.a,
              b: newest.b,
              trait: newest.trait,
              greaterIsB,
            });
            console.log(
              `[reactive] oracle reveal → pair a=#${newest.a} b=#${newest.b} trait=${newest.trait} op=${newest.op}`,
            );
          } else {
            console.log(
              `[reactive] reveals high-water set to ${lastSeen} (${data.reveals.length} historical)`,
            );
          }
        }
      } catch {
        // Ignore — try again on next tick.
      } finally {
        if (!cancelled) timer = setTimeout(() => tick(false), 5000);
      }
    }

    tick(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Hotkeys: m / n / e / c trigger synthetic chain events for screen-test
  // without needing actual on-chain activity.
  useEffect(() => {
    function pickRandomMintedId(): number | null {
      const ids: number[] = [];
      for (let i = 0; i < ENTITY_COUNT; i++) {
        if (reactiveState.mintedAt[i] >= 0) ids.push(i);
      }
      if (ids.length === 0) return null;
      return ids[Math.floor(Math.random() * ids.length)];
    }
    function pickNextUnmintedId(): number {
      for (let i = 0; i < ENTITY_COUNT; i++) {
        if (reactiveState.mintedAt[i] < 0) return i;
      }
      // Wrap: all minted, pick a random one to "re-mint" (no-op, logs only).
      return Math.floor(Math.random() * ENTITY_COUNT);
    }
    function onKey(ev: KeyboardEvent) {
      // Ignore when typing in an input/textarea (defensive — /full has none).
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const k = ev.key.toLowerCase();
      if (k === "m") {
        const axis = Math.random() < 0.3 ? 1 : 0;
        const dir = Math.random() < 0.5 ? -1 : 1;
        pushSweep(reactiveState.shaderTime, axis, dir);
        console.log(`[hotkey] m → synthetic sweep axis=${axis} dir=${dir}`);
      } else if (k === "n") {
        const id = pickNextUnmintedId();
        markMinted(id, reactiveState.shaderTime);
        console.log(`[hotkey] n → synthetic mint entity=#${id}`);
      } else if (k === "e") {
        const id = pickRandomMintedId();
        if (id === null) {
          console.log("[hotkey] e → no minted entities yet, press n first");
          return;
        }
        pulseEntity(id, reactiveState.shaderTime);
        console.log(`[hotkey] e → synthetic pulse entity=#${id}`);
      } else if (k === "c") {
        const a = pickRandomMintedId();
        const b = pickRandomMintedId();
        if (a === null || b === null || a === b) {
          console.log("[hotkey] c → need at least 2 distinct minted entities");
          return;
        }
        const trait = Math.floor(Math.random() * 7);
        const greaterIsB = Math.random() < 0.5 ? 0 : 1;
        setPair({
          birthTime: reactiveState.shaderTime,
          a,
          b,
          trait,
          greaterIsB,
        });
        console.log(
          `[hotkey] c → synthetic compare a=#${a} b=#${b} trait=${trait} greaterIsB=${greaterIsB}`,
        );
      }
    }
    document.addEventListener("keydown", onKey);
    console.log(
      "[reactive] hotkeys: m=move sweep, n=mint, e=entity pulse, c=compare",
    );
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <Stage
      className="stage-full"
      zoom={zoom}
      entityId={entityId}
      offsetX={offsetX}
      offsetY={offsetY}
    />
  );
}
