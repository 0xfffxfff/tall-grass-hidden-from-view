import { useEffect, useState } from "react";
import {
  useAccount,
  useWaitForTransactionReceipt,
} from "wagmi";
import { type Hex, formatEther, parseEther } from "viem";
import {
  useReadTallGrassDepositBalance,
  useWriteTallGrassDeposit,
  useWriteTallGrassMove,
  useWriteTallGrassRegister,
  useWriteTallGrassWithdrawDeposit,
} from "@/generated";
import { useAutoWalk, type WalkPattern } from "@/hooks/useAutoWalk";
import { useProver } from "@/hooks/useProver";
import { usePoseidon, poseidonHash } from "@/hooks/usePoseidon";
import { api, type EncounterData } from "@/api";
import { APP_CHAIN } from "@/chain";
import { workBus } from "@/lib/workBus";
import { WorkStrip } from "./WorkStrip";

interface Props {
  ready: "disconnected" | "wrong-chain" | "unregistered" | "registered";
  x: number | null;
  y: number | null;
  walkSecret: string | null;
  apiToken: string | null;
  participantMoveCount: number;
  gridWidth?: number;
  gridHeight?: number;
  onEncounters?: (encounters: EncounterData[]) => void;
  onMoved?: () => void;
  onRegistered?: () => void;
}

const DIRECTIONS = [
  { label: "N", dir: 0, dx: 0, dy: 1 },
  { label: "S", dir: 1, dx: 0, dy: -1 },
  { label: "E", dir: 2, dx: 1, dy: 0 },
  { label: "W", dir: 3, dx: -1, dy: 0 },
] as const;

const PATTERNS: WalkPattern[] = ["random", "zigzag", "spiral", "snake"];

function toBytes32(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}
function wrap(v: number, max: number): number {
  return ((v % max) + max) % max;
}

export function WalkInline({
  ready,
  x,
  y,
  walkSecret,
  apiToken,
  participantMoveCount,
  gridWidth = 32,
  gridHeight = 32,
  onEncounters,
  onMoved,
  onRegistered,
}: Props) {
  const { address } = useAccount();
  const poseidon = usePoseidon();
  const { ready: proverReady, prove } = useProver();
  const [showTopup, setShowTopup] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [topupAmount, setTopupAmount] = useState("0.01");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [status, setStatus] = useState("");

  const { data: depositBalance, refetch: refetchBalance } =
    useReadTallGrassDepositBalance({
      args: address ? [address as Hex] : undefined,
    });

  const autoWalk = useAutoWalk({
    x,
    y,
    walkSecret,
    apiToken,
    participantMoveCount,
    gridWidth,
    gridHeight,
    poseidon,
    prove,
    proverReady,
    address,
    depositBalance,
    onEncounters,
    onMoved,
  });

  const balanceStr = depositBalance ? formatEther(depositBalance) : "0";

  // ---- Manual steer move (sign-each-tx) ----
  const {
    writeContract: submitMove,
    data: moveTxHash,
    isPending: isMoveSigning,
    error: moveWriteError,
  } = useWriteTallGrassMove();
  const {
    isLoading: isMoveConfirming,
    isSuccess: moveConfirmed,
    error: moveTxError,
  } = useWaitForTransactionReceipt({ hash: moveTxHash });

  // Mirror manual-steer tx phases into the work bus so the strip stays honest.
  useEffect(() => {
    if (isMoveSigning) {
      workBus.update("manual-steer", "confirm in wallet");
    } else if (isMoveConfirming) {
      workBus.update("manual-steer", "waiting for chain confirmation");
    } else if (moveConfirmed || moveWriteError || moveTxError) {
      workBus.end("manual-steer");
    }
  }, [isMoveSigning, isMoveConfirming, moveConfirmed, moveWriteError, moveTxError]);

  useEffect(() => {
    if (!moveConfirmed || !address || !apiToken) return;
    onMoved?.();
    workBus.start({
      id: "manual-encounter",
      scope: "walk",
      label: "checking for encounters",
    });
    api
      .encounter(address, apiToken)
      .then((res) => {
        if (res.valid && res.encounters?.length) onEncounters?.(res.encounters);
      })
      .catch(() => {})
      .finally(() => workBus.end("manual-encounter"));
  }, [moveConfirmed, address, apiToken, onMoved, onEncounters]);

  async function steer(dir: (typeof DIRECTIONS)[number]) {
    if (
      !address ||
      !poseidon ||
      !walkSecret ||
      x === null ||
      y === null ||
      !proverReady
    )
      return;
    const wid = "manual-steer";
    try {
      setStatus(`proving (${dir.label})\u2026`);
      workBus.start({
        id: wid,
        scope: "walk",
        label: `proving move ${dir.label}`,
      });
      const newX = wrap(x + dir.dx, gridWidth);
      const newY = wrap(y + dir.dy, gridHeight);
      const ws = BigInt(walkSecret);
      const oldSalt = poseidonHash(poseidon, [ws, BigInt(participantMoveCount)]);
      const newSalt = poseidonHash(poseidon, [
        ws,
        BigInt(participantMoveCount + 1),
      ]);
      const oldCommitment = poseidonHash(poseidon, [
        BigInt(x),
        BigInt(y),
        oldSalt,
      ]);
      const newCommitment = poseidonHash(poseidon, [
        BigInt(newX),
        BigInt(newY),
        newSalt,
      ]);
      const proof = await prove({
        old_x: String(x),
        old_y: String(y),
        old_salt: oldSalt.toString(),
        new_x: String(newX),
        new_y: String(newY),
        new_salt: newSalt.toString(),
        direction: String(dir.dir),
        old_commitment: toBytes32(oldCommitment),
        new_commitment: toBytes32(newCommitment),
        grid_width: String(gridWidth),
        grid_height: String(gridHeight),
      });
      setStatus("confirm in wallet\u2026");
      workBus.update(wid, "confirm in wallet");
      submitMove({ args: [proof as Hex, toBytes32(newCommitment) as Hex] });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "steer failed");
      workBus.end(wid);
    }
  }

  // ---- Top-up deposit ----
  const {
    writeContract: deposit,
    data: depositTxHash,
    isPending: isDepositPending,
  } = useWriteTallGrassDeposit();
  const {
    isLoading: isDepositConfirming,
    isSuccess: depositConfirmed,
  } = useWaitForTransactionReceipt({
    hash: depositTxHash,
  });
  const depositBusy = isDepositPending || isDepositConfirming;

  useEffect(() => {
    if (isDepositPending) {
      workBus.start({
        id: "deposit",
        scope: "walk",
        label: "confirm deposit in wallet",
      });
    } else if (isDepositConfirming) {
      workBus.update("deposit", "waiting for chain confirmation (deposit)");
    } else if (depositConfirmed) {
      workBus.end("deposit");
      refetchBalance();
      setShowTopup(false);
    }
  }, [isDepositPending, isDepositConfirming, depositConfirmed, refetchBalance]);

  function submitTopup() {
    try {
      deposit({ value: parseEther(topupAmount) });
    } catch {
      setStatus("invalid amount");
    }
  }

  // ---- Withdraw deposit ----
  const {
    writeContract: withdraw,
    data: withdrawTxHash,
    isPending: isWithdrawPending,
  } = useWriteTallGrassWithdrawDeposit();
  const {
    isLoading: isWithdrawConfirming,
    isSuccess: withdrawConfirmed,
  } = useWaitForTransactionReceipt({ hash: withdrawTxHash });
  const withdrawBusy = isWithdrawPending || isWithdrawConfirming;

  useEffect(() => {
    if (isWithdrawPending) {
      workBus.start({
        id: "withdraw",
        scope: "walk",
        label: "confirm withdraw in wallet",
      });
    } else if (isWithdrawConfirming) {
      workBus.update("withdraw", "waiting for chain confirmation (withdraw)");
    } else if (withdrawConfirmed) {
      workBus.end("withdraw");
      refetchBalance();
      setShowWithdraw(false);
    }
  }, [isWithdrawPending, isWithdrawConfirming, withdrawConfirmed, refetchBalance]);

  function submitWithdraw() {
    try {
      const amount = withdrawAmount.trim() === ""
        ? (depositBalance ?? 0n)
        : parseEther(withdrawAmount);
      if (amount === 0n) {
        setStatus("nothing to withdraw");
        return;
      }
      withdraw({ args: [amount] });
    } catch {
      setStatus("invalid amount");
    }
  }

  // ---- Register (enter the landscape) ----
  const {
    writeContract: register,
    data: registerTxHash,
    isPending: isRegisterSigning,
  } = useWriteTallGrassRegister();
  const {
    isLoading: isRegisterConfirming,
    isSuccess: registerConfirmed,
  } = useWaitForTransactionReceipt({ hash: registerTxHash });
  const registerBusy = isRegisterSigning || isRegisterConfirming;

  useEffect(() => {
    if (isRegisterSigning) {
      workBus.update("register", "confirm registration in wallet");
    } else if (isRegisterConfirming) {
      workBus.update("register", "waiting for chain confirmation (register)");
    } else if (registerConfirmed) {
      workBus.end("register");
      const t = setTimeout(() => onRegistered?.(), 500);
      return () => clearTimeout(t);
    }
  }, [isRegisterSigning, isRegisterConfirming, registerConfirmed, onRegistered]);

  async function enter() {
    if (!address) return;
    workBus.start({
      id: "register",
      scope: "walk",
      label: "requesting position from oracle",
    });
    try {
      setStatus("requesting position\u2026");
      const result = await api.register(address);
      localStorage.setItem(
        `tg:apiToken:${address.toLowerCase()}`,
        result.apiToken,
      );
      setStatus("confirm in wallet\u2026");
      workBus.update("register", "confirm registration in wallet");
      register({ args: [result.commitment as Hex, result.signature as Hex] });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "registration failed");
      workBus.end("register");
    }
  }

  // ---- Pattern cycler ----
  function cyclePattern() {
    const idx = PATTERNS.indexOf(autoWalk.config.pattern);
    const next = PATTERNS[(idx + 1) % PATTERNS.length];
    autoWalk.setConfig((c) => ({ ...c, pattern: next }));
  }

  const moveError = moveWriteError || moveTxError;
  const liveStatus =
    autoWalk.status ||
    autoWalk.error ||
    status ||
    (moveError ? (moveError as Error).message : "");

  const isWalking = autoWalk.running;
  const canRelease =
    ready === "registered" && !!walkSecret && proverReady && !isWalking;
  const canStop = ready === "registered" && isWalking;
  const canSteer =
    ready === "registered" && proverReady && !isMoveSigning && !isMoveConfirming;
  const canTopup = ready === "registered" && !depositBusy;
  const canWithdraw =
    ready === "registered" &&
    !withdrawBusy &&
    (depositBalance ?? 0n) > 0n;
  const canEnter = ready === "unregistered" && !registerBusy;
  const canPattern = ready === "registered" && !isWalking;

  // why-prose for transient/non-disconnected states only — the connect pill
  // already speaks for itself when no wallet is present.
  let whyMessage = "";
  if (ready === "wrong-chain") whyMessage = `Switch to ${APP_CHAIN.name.toLowerCase()} to walk.`;
  else if (!proverReady && ready === "registered") whyMessage = "Loading the prover\u2026";

  return (
    <section className="walk">
      <h2>walking</h2>
      <p>
        Any visitor with a wallet may walk through the landscape. One cell at
        a time, in any cardinal direction. Each step is a zero-knowledge
        proof, generated on your device &mdash; no remote prover, no GPU
        farm. The contract verifies the proof without learning where the move
        happened. The trace stays in the field forever.
      </p>

      {ready === "unregistered" && (
        <p className="enter-row">
          <button
            className={"aff" + (canEnter ? " live" : registerBusy ? " busy" : "")}
            onClick={() => canEnter && enter()}
            disabled={!canEnter}
          >
            {registerBusy ? "entering\u2026" : "enter the landscape"}
          </button>
        </p>
      )}

      <div className="instrument">
        <span className="instrument-label">walk</span>
        <div
          className={"steer-pad" + (canSteer ? "" : " off")}
          role="group"
          aria-label="walk"
        >
          <div className="glyph empty" />
          <div
            className="glyph"
            onClick={() => canSteer && steer(DIRECTIONS[0])}
          >
            N
          </div>
          <div className="glyph empty" />
          <div
            className="glyph"
            onClick={() => canSteer && steer(DIRECTIONS[3])}
          >
            W
          </div>
          <div className="glyph empty" />
          <div
            className="glyph"
            onClick={() => canSteer && steer(DIRECTIONS[2])}
          >
            E
          </div>
          <div className="glyph empty" />
          <div
            className="glyph"
            onClick={() => canSteer && steer(DIRECTIONS[1])}
          >
            S
          </div>
          <div className="glyph empty" />
        </div>
      </div>

      <div className="instrument">
        <span className="instrument-label">auto-walk</span>
        <div className="instrument-row">
          {!isWalking ? (
            <button
              className={"aff" + (canRelease ? " live" : "")}
              onClick={() => canRelease && autoWalk.start()}
              disabled={!canRelease}
            >
              autowalk
            </button>
          ) : (
            <button
              className={"aff" + (canStop ? " live" : "")}
              onClick={() => canStop && autoWalk.pause()}
              disabled={!canStop}
            >
              stop
            </button>
          )}
          <button
            className={"aff" + (canPattern ? " live" : "")}
            onClick={() => canPattern && cyclePattern()}
            disabled={!canPattern}
            title="cycle walk pattern"
          >
            pattern <span className="kv">{autoWalk.config.pattern}</span>
          </button>
        </div>
      </div>

      <div className="instrument">
        <span className="instrument-label">auto-walk balance</span>
        <div className="instrument-row">
          <span className="balance">{balanceStr} eth</span>
          <button
            className={"aff" + (canTopup ? " live" : "") + (showTopup ? " open" : "")}
            onClick={() => canTopup && setShowTopup((v) => !v)}
            disabled={!canTopup}
          >
            top up
          </button>
          <button
            className={
              "aff" +
              (canWithdraw ? " live" : "") +
              (showWithdraw ? " open" : "")
            }
            onClick={() => canWithdraw && setShowWithdraw((v) => !v)}
            disabled={!canWithdraw}
          >
            withdraw
          </button>
        </div>
      </div>

      {showTopup && canTopup && (
        <div className="topup-form">
          <span className="kv-lab">balance</span>
          <span className="kv">{balanceStr} eth</span>
          <span className="sep-dot">&middot;</span>
          <input
            type="text"
            value={topupAmount}
            onChange={(e) => setTopupAmount(e.target.value)}
            placeholder="0.01"
          />
          <span className="kv-lab">eth</span>
          <button
            className={"aff" + (depositBusy ? " busy" : " live")}
            onClick={submitTopup}
            disabled={depositBusy}
            style={{ marginLeft: 8 }}
          >
            {depositBusy ? "depositing\u2026" : "deposit"}
          </button>
        </div>
      )}

      {showWithdraw && canWithdraw && (
        <div className="topup-form">
          <span className="kv-lab">balance</span>
          <span className="kv">{balanceStr} eth</span>
          <span className="sep-dot">&middot;</span>
          <input
            type="text"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="all"
          />
          <span className="kv-lab">eth</span>
          <button
            className={"aff" + (withdrawBusy ? " busy" : " live")}
            onClick={submitWithdraw}
            disabled={withdrawBusy}
            style={{ marginLeft: 8 }}
          >
            {withdrawBusy ? "withdrawing\u2026" : "withdraw"}
          </button>
        </div>
      )}

      {whyMessage && <p className="why">{whyMessage}</p>}
      <WorkStrip scope="walk" className="walk-work" />
      {ready === "registered" && liveStatus && !whyMessage && (
        <p className="walk-error">{liveStatus}</p>
      )}
      {ready === "registered" && autoWalk.history.length > 0 && (
        <ul className="walk-history">
          {autoWalk.history.slice(0, 6).map((step) => {
            const dir = ["N", "S", "E", "W"][step.direction];
            const word = ["north", "south", "east", "west"][step.direction];
            return (
              <li key={`${step.step}-${step.timestamp}`}>
                <span className="dir">{dir}</span>
                <span className="sep">&middot;</span>
                <span>moved {word}</span>
                {step.encounter && (
                  <>
                    <span className="sep">&middot;</span>
                    <span className="meta">encounter</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
