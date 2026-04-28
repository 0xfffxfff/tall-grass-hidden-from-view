import { useState, useRef, useCallback, useEffect } from "react";
import { type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { poseidonHash, type PoseidonHasher } from "@/hooks/usePoseidon";
import { api, type EncounterData } from "@/api";
import { workBus } from "@/lib/workBus";

const WORK_ID = "auto-walk";

export type WalkPattern = "random" | "zigzag" | "spiral" | "snake";

export interface AutoWalkStep {
  step: number;
  direction: number;
  encounter: boolean;
  timestamp: number;
}

export interface AutoWalkConfig {
  pattern: WalkPattern;
  stopOnEncounter: boolean;
  gasLimitWei: bigint;
  maxSteps: number | null;
}

interface AutoWalkInputs {
  x: number | null;
  y: number | null;
  walkSecret: string | null;
  apiToken: string | null;
  participantMoveCount: number;
  gridWidth: number;
  gridHeight: number;
  poseidon: PoseidonHasher | null;
  prove: (inputs: Record<string, string>) => Promise<string>;
  proverReady: boolean;
  address: string | undefined;
  depositBalance: bigint | undefined;
  onEncounters?: (encounters: EncounterData[]) => void;
  onMoved?: () => void;
}

const DIR_DELTAS = [
  { dx: 0, dy: 1 },  // 0: N
  { dx: 0, dy: -1 }, // 1: S
  { dx: 1, dy: 0 },  // 2: E
  { dx: -1, dy: 0 }, // 3: W
];

export const DIR_LABELS = ["N", "S", "E", "W"];

function wrap(v: number, max: number): number {
  return ((v % max) + max) % max;
}

function toBytes32(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

function getDirection(
  pattern: WalkPattern,
  stepIndex: number,
  gridWidth: number,
): number {
  switch (pattern) {
    case "random":
      return Math.floor(Math.random() * 4);

    case "zigzag":
      // Alternates E, N, E, N... — diagonal coverage
      return stepIndex % 2 === 0 ? 2 : 0;

    case "spiral": {
      // Expanding spiral: N×1, E×1, S×2, W×2, N×3, E×3...
      const dirs = [0, 2, 1, 3]; // N, E, S, W
      let remaining = stepIndex;
      let segLen = 1;
      let segCount = 0;
      while (remaining >= segLen) {
        remaining -= segLen;
        segCount++;
        if (segCount % 2 === 0) segLen++;
      }
      return dirs[segCount % 4];
    }

    case "snake": {
      // Move E for gridWidth-1 steps, shift N, move W, shift N...
      const cycleLen = gridWidth;
      const cycle = Math.floor(stepIndex / cycleLen);
      const pos = stepIndex % cycleLen;
      if (pos < gridWidth - 1) {
        return cycle % 2 === 0 ? 2 : 3;
      }
      return 0; // shift row
    }

    default:
      return Math.floor(Math.random() * 4);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function useAutoWalk(inputs: AutoWalkInputs) {
  const publicClient = usePublicClient();

  const [running, setRunning] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const [history, setHistory] = useState<AutoWalkStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [config, setConfig] = useState<AutoWalkConfig>({
    pattern: "random",
    stopOnEncounter: true,
    gasLimitWei: 0n,
    maxSteps: null,
  });

  const runningRef = useRef(false);
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const configRef = useRef(config);
  configRef.current = config;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

  const addStep = useCallback(
    (step: number, direction: number, encounter: boolean) => {
      setHistory((prev) =>
        [{ step, direction, encounter, timestamp: Date.now() }, ...prev].slice(
          0,
          50,
        ),
      );
    },
    [],
  );

  const start = useCallback(() => {
    const inp = inputsRef.current;
    if (
      inp.x === null ||
      inp.y === null ||
      !inp.walkSecret ||
      !inp.poseidon ||
      !inp.proverReady ||
      !inp.address ||
      !publicClient
    ) {
      setError("Not ready");
      return;
    }
    if (runningRef.current) return;

    runningRef.current = true;
    setRunning(true);
    setError(null);

    // Capture initial position — loop tracks its own state
    let cx = inp.x;
    let cy = inp.y;
    let moveCount = inp.participantMoveCount;
    let stepIdx = 0;

    const loop = async () => {
      while (runningRef.current) {
        try {
          const cfg = configRef.current;

          // Check max steps
          if (cfg.maxSteps !== null && stepIdx >= cfg.maxSteps) {
            setStatus("max steps reached");
            break;
          }

          // Check gas limit
          if (cfg.gasLimitWei > 0n) {
            const bal = inputsRef.current.depositBalance;
            if (bal !== undefined && bal < cfg.gasLimitWei) {
              setStatus("deposit below limit");
              break;
            }
          }

          const dir = getDirection(
            cfg.pattern,
            stepIdx,
            inputsRef.current.gridWidth,
          );
          const delta = DIR_DELTAS[dir];
          const newX = wrap(cx + delta.dx, inputsRef.current.gridWidth);
          const newY = wrap(cy + delta.dy, inputsRef.current.gridHeight);

          // Derive salts
          const ws = BigInt(inputsRef.current.walkSecret!);
          const pos = inputsRef.current.poseidon!;
          const oldSalt = poseidonHash(pos, [ws, BigInt(moveCount)]);
          const newSalt = poseidonHash(pos, [ws, BigInt(moveCount + 1)]);

          // Compute commitments
          const oldCommitment = poseidonHash(pos, [
            BigInt(cx),
            BigInt(cy),
            oldSalt,
          ]);
          const newCommitment = poseidonHash(pos, [
            BigInt(newX),
            BigInt(newY),
            newSalt,
          ]);

          setStatus(`proving (${DIR_LABELS[dir]})...`);
          workBus.start({
            id: WORK_ID,
            scope: "walk",
            label: `proving move ${DIR_LABELS[dir]} (step ${stepIdx + 1})`,
          });
          const proof = await inputsRef.current.prove({
            old_x: String(cx),
            old_y: String(cy),
            old_salt: oldSalt.toString(),
            new_x: String(newX),
            new_y: String(newY),
            new_salt: newSalt.toString(),
            direction: String(dir),
            old_commitment: toBytes32(oldCommitment),
            new_commitment: toBytes32(newCommitment),
            grid_width: String(inputsRef.current.gridWidth),
            grid_height: String(inputsRef.current.gridHeight),
          });

          if (!runningRef.current) break;

          setStatus("relaying...");
          workBus.update(WORK_ID, "relaying through oracle");
          const relayResult = await api.relay(
            inputsRef.current.address!,
            proof,
            toBytes32(newCommitment),
          );

          if (!runningRef.current) break;

          setStatus("confirming...");
          workBus.update(WORK_ID, "waiting for chain confirmation");
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: relayResult.txHash as Hex,
          });
          // The relay can revert on chain (verifier returned false, gas
          // reimbursement failure, etc). Treating a reverted tx as success
          // would advance our local cx/cy past a move that never landed,
          // and every subsequent proof would verify against a chain
          // commitment that never existed — a cascading failure across the
          // rest of the walk. Pause and surface the revert instead.
          if (receipt.status !== "success") {
            throw new Error(
              `relay tx reverted on chain (${relayResult.txHash.slice(0, 10)})`,
            );
          }

          // Update internal tracking
          cx = newX;
          cy = newY;
          moveCount++;
          stepIdx++;
          setStepCount(stepIdx);

          // Notify parent
          inputsRef.current.onMoved?.();

          // Check encounters
          setStatus("checking encounters...");
          workBus.update(WORK_ID, "checking for encounters");
          try {
            const enc = await api.encounter(inputsRef.current.address!, inputsRef.current.apiToken!);
            if (enc.valid && enc.encounters?.length) {
              inputsRef.current.onEncounters?.(enc.encounters);
              addStep(stepIdx, dir, true);
              if (configRef.current.stopOnEncounter) {
                setStatus("encounter — paused");
                break;
              }
            } else {
              addStep(stepIdx, dir, false);
            }
          } catch {
            // Encounter check failure is non-fatal
            addStep(stepIdx, dir, false);
          }

          if (!runningRef.current) break;
          setStatus("waiting...");
          await sleep(500);
        } catch (e) {
          setError(e instanceof Error ? e.message : "auto-walk error");
          setStatus("error — paused");
          break;
        }
      }

      runningRef.current = false;
      setRunning(false);
      workBus.end(WORK_ID);
    };

    loop();
  }, [publicClient, addStep]);

  const pause = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setStatus("");
    workBus.end(WORK_ID);
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setStepCount(0);
    setHistory([]);
    setError(null);
    setStatus("");
  }, []);

  return {
    running,
    stepCount,
    history,
    error,
    status,
    config,
    setConfig,
    start,
    pause,
    reset,
  };
}
