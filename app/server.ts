// Tall Grass — Server.
//
// Single Node.js process: encounter proof generation, FHE oracle, static files.
// Hono + @hono/node-server.

import { config } from "./config.js";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  Wallet,
  JsonRpcProvider,
  FallbackProvider,
  Contract,
  keccak256,
  concat,
  toUtf8Bytes,
  solidityPackedKeccak256,
  getBytes,
  verifyMessage,
  ZeroHash,
} from "ethers";

const SEPOLIA_PUBLIC_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://1rpc.io/sepolia",
  "https://sepolia.gateway.tenderly.co",
];

const POLL_INTERVAL_MS = 12_500;

const SEPOLIA_CHAIN_ID = 11155111;

function buildProvider(rpcUrl: string): JsonRpcProvider | FallbackProvider {
  const isLocal = /(?:localhost|127\.0\.0\.1)/.test(rpcUrl);
  if (isLocal) {
    return new JsonRpcProvider(rpcUrl, undefined, {
      pollingInterval: POLL_INTERVAL_MS,
    });
  }
  const mk = (url: string) =>
    new JsonRpcProvider(url, SEPOLIA_CHAIN_ID, { staticNetwork: true });
  // The configured RPC (Alchemy/Infura/etc) leads. Public RPCs back it up
  // for live tip reads; they refuse archive eth_getLogs once the deploy
  // block falls outside the hot window, so they cannot be primary.
  const configs = [
    {
      provider: mk(rpcUrl),
      priority: 1,
      stallTimeout: 2_000,
      weight: 1,
    },
    ...SEPOLIA_PUBLIC_RPCS.map((url, i) => ({
      provider: mk(url),
      priority: i + 2,
      stallTimeout: 2_000,
      weight: 1,
    })),
  ];
  return new FallbackProvider(configs, SEPOLIA_CHAIN_ID, {
    quorum: 1,
    pollingInterval: POLL_INTERVAL_MS,
  });
}
import type { PoseidonHasher } from "circomlibjs";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface Participant {
  x: number;
  y: number;
  salt: bigint;
  moveCount: number;
  walkSecret: bigint;
}

interface EntityPosition {
  x: number;
  y: number;
}

interface MerkleEntityData {
  ciphertextHash: string;
  proof: string[];
}

interface MerkleData {
  root: string;
  entities: Record<number, MerkleEntityData>;
}

interface ManifestData {
  seed: string;
  entityCount: number;
}

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

interface TFHEModule {
  _tfhe_malloc(size: number): number;
  _tfhe_free(ptr: number): void;
  HEAPU8: Uint8Array;
  ccall(
    name: string,
    returnType: string,
    argTypes: string[],
    args: unknown[],
  ): number;
}

interface NoirInstance {
  execute(inputs: Record<string, unknown>): Promise<{ witness: Uint8Array }>;
}

interface BackendInstance {
  generateProof(
    witness: Uint8Array,
    opts: { keccak: boolean },
  ): Promise<{ proof: Uint8Array }>;
}

// ---------------------------------------------------------------------------
// Config — see config.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const participants = new Map<string, Participant>();
const mintedEntities = new Set<number>();
let entityPositions: EntityPosition[] = [];
let seed = 0n;
let moveCounter = 0;

interface ComparisonProofCache {
  entityA: number;
  entityB: number;
  traitIndex: number;
  result: string;
  claimedGt: boolean;
  claimedEq: boolean;
  proof: string;
  revealedAt?: number; // epoch ms — added 2026-04
  revealer?: string;   // address or "anon" — added 2026-04
}

// Loaded at startup — non-nullable after init()
interface Services {
  poseidon: PoseidonHasher;
  oracleWallet: Wallet;
  masterSecret: bigint;
  provider: JsonRpcProvider | FallbackProvider;
  contract: Contract | null;
  deployBlock: number;
  encounterNoir: NoirInstance | null;
  encounterBackend: BackendInstance | null;
  decryptionNoir: NoirInstance | null;
  decryptionBackend: BackendInstance | null;
  fheModule: TFHEModule | null;
  merkleData: MerkleData | null;
  manifestData: ManifestData | null;
  lweKeyBits: number[] | null;
  decryptionKeyCommitment: string | null;
}

let svc!: Services;
const comparisonProofCache = new Map<string, ComparisonProofCache>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBytes32(n: bigint | number): string {
  return "0x" + BigInt(n).toString(16).padStart(64, "0");
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = svc.poseidon(inputs);
  return svc.poseidon.F.toObject(hash);
}

function applyMove(x: number, y: number, direction: number): { x: number; y: number } {
  switch (direction) {
    case 0: return { x, y: (y + 1) % config.GRID_HEIGHT };               // North
    case 1: return { x, y: (y - 1 + config.GRID_HEIGHT) % config.GRID_HEIGHT }; // South
    case 2: return { x: (x + 1) % config.GRID_WIDTH, y };                // East
    case 3: return { x: (x - 1 + config.GRID_WIDTH) % config.GRID_WIDTH, y };   // West
    default: throw new Error(`Invalid direction: ${direction}`);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.slice(i, i + 2), 16);
  }
  return bytes;
}

function comparisonCacheKey(a: number, b: number, t: number): string {
  return `${a}_${b}_${t}`;
}

// Parse a serialized TFHE LweSample (2016 bytes) into mask vector a[500] and body b.
// Layout: 4 bytes UID (42) | 500 x u32 LE (a[]) | 1 x u32 LE (b) | 8 bytes variance
function parseLweSample(data: Uint8Array): { a: number[]; b: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const a: number[] = [];
  let offset = 4; // skip UID
  for (let i = 0; i < 500; i++) {
    a.push(view.getUint32(offset, true));
    offset += 4;
  }
  const b = view.getUint32(offset, true);
  return { a, b };
}

function deriveWalkSecret(address: string): bigint {
  return poseidonHash([svc.masterSecret, BigInt(address)]);
}

function deriveApiToken(address: string): string {
  const masterHex = svc.oracleWallet.privateKey;
  return keccak256(
    toUtf8Bytes("tall_grass:api:" + masterHex + address.toLowerCase()),
  );
}

function deriveSalt(walkSecret: bigint, moveIndex: number): bigint {
  return poseidonHash([walkSecret, BigInt(moveIndex)]);
}

// Spawn coordinates are derived deterministically from walkSecret so the
// oracle can recompute them on restart. The 3-input form is domain-separated
// from deriveSalt's 2-input form, so the spawn hash can never collide with
// any move-N salt for the same wallet.
function deriveSpawn(walkSecret: bigint): { x: number; y: number } {
  const h = poseidonHash([walkSecret, 0n, 0n]);
  const x = Number(h % BigInt(config.GRID_WIDTH));
  const y = Number((h / BigInt(config.GRID_WIDTH)) % BigInt(config.GRID_HEIGHT));
  return { x, y };
}

// Pre-commit-3889248 wallets registered from the grid center. Resolve which
// spawn a given wallet actually used by matching candidate H(spawn, salt0)
// against the initial position commitment from its Registered event.
function resolveSpawn(
  walkSecret: bigint,
  initialCommitment: bigint,
): { x: number; y: number } | null {
  const salt0 = deriveSalt(walkSecret, 0);
  const current = deriveSpawn(walkSecret);
  if (poseidonHash([BigInt(current.x), BigInt(current.y), salt0]) === initialCommitment) {
    return current;
  }
  const legacy = {
    x: Math.floor(config.GRID_WIDTH / 2),
    y: Math.floor(config.GRID_HEIGHT / 2),
  };
  if (poseidonHash([BigInt(legacy.x), BigInt(legacy.y), salt0]) === initialCommitment) {
    return legacy;
  }
  return null;
}

function deriveBlindingSeed(entityId: number): bigint {
  return poseidonHash([seed, BigInt(entityId)]);
}

function deriveEntitySalt(blindingSeed: bigint, moveCount: number): bigint {
  return poseidonHash([blindingSeed, BigInt(moveCount), 0n]);
}

function replayPositionMoves(
  startX: number,
  startY: number,
  events: { newCommitment: bigint }[],
  saltFn: (moveIndex: number) => bigint,
): { x: number; y: number; moveCount: number } | null {
  let x = startX;
  let y = startY;
  let moveIndex = 0;

  for (const event of events) {
    moveIndex++;
    const newSalt = saltFn(moveIndex);
    let found = false;
    for (let dir = 0; dir < 4; dir++) {
      const { x: nx, y: ny } = applyMove(x, y, dir);
      const candidate = poseidonHash([BigInt(nx), BigInt(ny), newSalt]);
      if (candidate === event.newCommitment) {
        x = nx;
        y = ny;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }

  return { x, y, moveCount: moveIndex };
}

function replayEntityDirectionMoves(
  startX: number,
  startY: number,
  events: { directionCommitment: bigint }[],
  blindingSeed: bigint,
): { x: number; y: number } | null {
  let x = startX;
  let y = startY;

  for (let i = 0; i < events.length; i++) {
    const blinding = poseidonHash([blindingSeed, BigInt(i)]);
    let found = false;
    for (let dir = 0; dir < 4; dir++) {
      const candidate = poseidonHash([BigInt(dir), blinding]);
      if (candidate === events[i].directionCommitment) {
        const moved = applyMove(x, y, dir);
        x = moved.x;
        y = moved.y;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }

  return { x, y };
}

// ---------------------------------------------------------------------------
// Entity position computation
// ---------------------------------------------------------------------------

function initEntityPositions(): void {
  entityPositions = [];
  for (let i = 0; i < config.ENTITY_COUNT; i++) {
    const h = poseidonHash([seed, BigInt(i)]);
    // Extract lower 32 bits, then modular arithmetic (matches circuit)
    const hLow = h & 0xFFFFFFFFn;
    const x = Number(hLow % BigInt(config.GRID_WIDTH));
    const y = Number((hLow / BigInt(config.GRID_WIDTH)) % BigInt(config.GRID_HEIGHT));
    entityPositions.push({ x, y });
  }
}

// ---------------------------------------------------------------------------
// Encounter proof generation (server-side, oracle knows seed)
// ---------------------------------------------------------------------------

async function generateEncounterProof(
  participant: Participant,
  entityId: number,
): Promise<{
  encounterProof: string;
  entityTraitHash: string;
  traitMerkleProof: string[];
  initialPositionCommitment: string;
  blindingSeedCommitment: string;
} | null> {
  const noir = svc.encounterNoir;
  const backend = svc.encounterBackend;
  if (!noir || !backend) return null;

  const ep = entityPositions[entityId];
  if (participant.x !== ep.x || participant.y !== ep.y) return null;

  const blindingSeed = deriveBlindingSeed(entityId);
  const seedCommitment = poseidonHash([seed]);
  const positionCommitment = poseidonHash([BigInt(participant.x), BigInt(participant.y), participant.salt]);

  const blindingSeedCommitment = poseidonHash([blindingSeed]);
  const entityInitialSalt = deriveEntitySalt(blindingSeed, 0);
  const initialPositionCommitment = poseidonHash([BigInt(ep.x), BigInt(ep.y), entityInitialSalt]);

  const inputs: Record<string, string> = {
    seed: String(seed),
    participant_x: String(participant.x),
    participant_y: String(participant.y),
    participant_salt: String(participant.salt),
    seed_commitment: String(seedCommitment),
    entity_id: String(entityId),
    position_commitment: String(positionCommitment),
    grid_width: String(config.GRID_WIDTH),
    grid_height: String(config.GRID_HEIGHT),
    initial_position_commitment: String(initialPositionCommitment),
    blinding_seed_commitment: String(blindingSeedCommitment),
  };

  console.log(`  Generating encounter proof for entity ${entityId}...`);
  const t0 = performance.now();
  const { witness } = await noir.execute(inputs);
  const proofResult = await backend.generateProof(witness, { keccak: true });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`  Encounter proof generated in ${elapsed}s`);

  let entityTraitHash = ZeroHash;
  let traitMerkleProof: string[] = [];
  const md = svc.merkleData;
  if (md && md.entities[entityId]) {
    const entity = md.entities[entityId];
    entityTraitHash = entity.ciphertextHash;
    traitMerkleProof = entity.proof;
  }

  return {
    encounterProof: "0x" + bytesToHex(proofResult.proof),
    entityTraitHash,
    traitMerkleProof,
    initialPositionCommitment: toBytes32(initialPositionCommitment),
    blindingSeedCommitment: toBytes32(blindingSeedCommitment),
  };
}

// ---------------------------------------------------------------------------
// Recovery from on-chain events
// ---------------------------------------------------------------------------

// Many public RPCs cap eth_getLogs at a 50K block window. Paginate to stay
// under the limit when scanning from deploy block to head.
const LOG_QUERY_WINDOW = 45_000;

// Reorg cushion when persisting lastBlock — next startup rescans this many
// blocks behind the saved tip in case a short reorg moved them. Sepolia
// reorgs are typically <12 blocks.
const SNAPSHOT_REORG_CUSHION = 12;

async function queryFilterPaged(
  contract: Contract,
  filter: Parameters<Contract["queryFilter"]>[0],
  fromBlock: number,
  toBlock?: number,
): Promise<Awaited<ReturnType<Contract["queryFilter"]>>> {
  const latest = toBlock ?? (await svc.provider.getBlockNumber());
  const out: Awaited<ReturnType<Contract["queryFilter"]>> = [];
  for (let start = fromBlock; start <= latest; start += LOG_QUERY_WINDOW) {
    const end = Math.min(start + LOG_QUERY_WINDOW - 1, latest);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const chunk = await contract.queryFilter(filter, start, end);
        out.push(...chunk);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const backoff = Math.min(30_000, 500 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

// ---------------------------------------------------------------------------
// State snapshot — avoid re-scanning from deploy block on every restart.
// ---------------------------------------------------------------------------

interface SnapshotShape {
  version: 1;
  contractAddress: string;
  lastBlock: number;
  participants: {
    address: string;
    x: number;
    y: number;
    salt: string;
    moveCount: number;
    walkSecret: string;
  }[];
  mintedEntities: number[];
}

function snapshotPath(): string {
  return join(config.DATA_DIR, "snapshot.json");
}

function loadSnapshot(contractAddress: string): SnapshotShape | null {
  const path = snapshotPath();
  if (!existsSync(path)) return null;
  try {
    const snap = JSON.parse(readFileSync(path, "utf-8")) as SnapshotShape;
    if (snap.version !== 1) return null;
    if (snap.contractAddress.toLowerCase() !== contractAddress.toLowerCase()) {
      console.log(`  Snapshot is for ${snap.contractAddress}, current contract is ${contractAddress}. Ignoring.`);
      return null;
    }
    return snap;
  } catch (err) {
    console.error(`  Failed to read snapshot, falling back to full scan: ${(err as Error).message}`);
    return null;
  }
}

function saveSnapshot(contractAddress: string, lastBlock: number): void {
  const snap: SnapshotShape = {
    version: 1,
    contractAddress: contractAddress.toLowerCase(),
    lastBlock: Math.max(0, lastBlock - SNAPSHOT_REORG_CUSHION),
    participants: Array.from(participants.entries()).map(([address, p]) => ({
      address,
      x: p.x,
      y: p.y,
      salt: "0x" + p.salt.toString(16),
      moveCount: p.moveCount,
      walkSecret: "0x" + p.walkSecret.toString(16),
    })),
    mintedEntities: Array.from(mintedEntities).sort((a, b) => a - b),
  };
  const path = snapshotPath();
  const tmp = path + ".tmp";
  try {
    if (!existsSync(config.DATA_DIR)) mkdirSync(config.DATA_DIR, { recursive: true });
    writeFileSync(tmp, JSON.stringify(snap));
    require("fs").renameSync(tmp, path);
  } catch (err) {
    console.error(`  Snapshot write failed: ${(err as Error).message}`);
  }
}

async function recoverFromChain(contract: Contract): Promise<void> {
  const contractAddress = await contract.getAddress();
  const tipBlock = await svc.provider.getBlockNumber();
  const snap = loadSnapshot(contractAddress);

  participants.clear();
  mintedEntities.clear();

  let scanFrom = svc.deployBlock;
  if (snap) {
    for (const p of snap.participants) {
      participants.set(p.address, {
        x: p.x,
        y: p.y,
        salt: BigInt(p.salt),
        moveCount: p.moveCount,
        walkSecret: BigInt(p.walkSecret),
      });
    }
    for (const id of snap.mintedEntities) mintedEntities.add(id);
    scanFrom = Math.max(svc.deployBlock, snap.lastBlock + 1);
    console.log(`  Loaded snapshot @ block ${snap.lastBlock}: ${participants.size} participants, ${mintedEntities.size} minted entities.`);
    console.log(`  Catching up ${scanFrom} -> ${tipBlock} (${tipBlock - scanFrom} blocks)...`);
  } else {
    console.log(`  No snapshot. Full scan ${scanFrom} -> ${tipBlock} (${tipBlock - scanFrom} blocks)...`);
  }

  // 1. Registered events in the catch-up window -> add new participants.
  const regEvents = await queryFilterPaged(
    contract,
    contract.filters.Registered(),
    scanFrom,
    tipBlock,
  );
  console.log(`  Found ${regEvents.length} new registrations.`);

  for (const event of regEvents) {
    const args = (event as unknown as { args: { participant: string; positionCommitment: string } }).args;
    const address = args.participant.toLowerCase();
    if (participants.has(address)) continue;
    const initialCommitment = BigInt(args.positionCommitment);
    const walkSecret = deriveWalkSecret(address);
    const spawn = resolveSpawn(walkSecret, initialCommitment);
    if (!spawn) {
      console.error(`  Cannot resolve spawn for ${address.slice(0, 8)}... (initial commitment matches neither legacy nor current derivation)`);
      continue;
    }
    const salt0 = deriveSalt(walkSecret, 0);
    participants.set(address, { x: spawn.x, y: spawn.y, salt: salt0, moveCount: 0, walkSecret });
  }

  // 2. Moved events in the catch-up window -> advance each affected
  // participant. We scan all Moved (no address filter) in the same window
  // so one RPC call covers everyone, then dispatch per-address.
  const movedAll = await queryFilterPaged(
    contract,
    contract.filters.Moved(),
    scanFrom,
    tipBlock,
  );
  const movedByAddr = new Map<string, typeof movedAll>();
  for (const ev of movedAll) {
    const addr = ((ev as unknown as { args: { participant: string } }).args.participant).toLowerCase();
    let bucket = movedByAddr.get(addr);
    if (!bucket) { bucket = []; movedByAddr.set(addr, bucket); }
    bucket.push(ev);
  }
  for (const [address, events] of movedByAddr) {
    const participant = participants.get(address);
    if (!participant) continue;
    const sorted = events.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    const parsed = sorted.map((e) => ({
      newCommitment: BigInt((e as unknown as { args: { newCommitment: string } }).args.newCommitment),
    }));
    const result = replayPositionMoves(
      participant.x, participant.y,
      parsed, (i) => deriveSalt(participant.walkSecret, participant.moveCount + i),
    );
    if (result) {
      participant.x = result.x;
      participant.y = result.y;
      participant.moveCount += result.moveCount;
      participant.salt = deriveSalt(participant.walkSecret, participant.moveCount);
    } else {
      console.error(`  Cannot apply moves for ${address.slice(0, 8)}... (commitment chain broken)`);
    }
  }

  console.log(`  Recovered ${participants.size} participants.`);

  // 3. Minted events in the catch-up window.
  const mintEvents = await queryFilterPaged(contract, contract.filters.Minted(), scanFrom, tipBlock);
  for (const event of mintEvents) {
    const args = (event as unknown as { args: { entityId: bigint } }).args;
    mintedEntities.add(Number(args.entityId));
  }
  console.log(`  Recovered ${mintedEntities.size} minted entities.`);

  // 4. Read live global moveCounter from contract (cheap, no logs).
  const onChainMoveCounter = await contract.moveCounter() as bigint;
  moveCounter = Number(onChainMoveCounter);
  console.log(`  Move counter: ${moveCounter}`);

  // 5. Persist the snapshot so the next restart skips this work.
  saveSnapshot(contractAddress, tipBlock);
  console.log(`  Snapshot saved @ block ${tipBlock - SNAPSHOT_REORG_CUSHION}.`);
}

// ---------------------------------------------------------------------------
// Live chain event listener
// ---------------------------------------------------------------------------

function subscribeToEvents(contract: Contract): void {
  contract.on("Registered", (participantAddr: string) => {
    const key = participantAddr.toLowerCase();
    if (participants.has(key)) return;
    const walkSecret = deriveWalkSecret(participantAddr);
    const { x, y } = deriveSpawn(walkSecret);
    const salt = deriveSalt(walkSecret, 0);
    participants.set(key, { x, y, salt, moveCount: 0, walkSecret });
    console.log(`  [event] Registered ${key.slice(0, 8)}...`);
  });

  contract.on("Moved", (participantAddr: string, newCommitment: string, onChainMoveCounter: bigint) => {
    const key = participantAddr.toLowerCase();
    const participant = participants.get(key);
    if (!participant) return;

    const chainMC = Number(onChainMoveCounter);
    // Guard: only update if we haven't already advanced (prevents race with relay .then())
    if (participant.moveCount >= chainMC) return;

    const expectedMoveCount = participant.moveCount + 1;
    const newSalt = deriveSalt(participant.walkSecret, expectedMoveCount);
    const target = BigInt(newCommitment);
    for (let dir = 0; dir < 4; dir++) {
      const { x: nx, y: ny } = applyMove(participant.x, participant.y, dir);
      const candidate = poseidonHash([BigInt(nx), BigInt(ny), newSalt]);
      if (candidate === target) {
        participant.x = nx;
        participant.y = ny;
        participant.salt = newSalt;
        participant.moveCount = expectedMoveCount;
        moveCounter = chainMC;
        console.log(`  [event] Moved ${key.slice(0, 8)}... -> (${nx},${ny}) mc=${chainMC}`);
        return;
      }
    }
    console.warn(`  [event] Could not decode move for ${key.slice(0, 8)}...`);
  });

  contract.on("Minted", (_participant: string, entityId: bigint, onChainMoveCounter: bigint) => {
    mintedEntities.add(Number(entityId));
    moveCounter = Number(onChainMoveCounter);
    console.log(`  [event] Minted entity ${entityId} mc=${moveCounter}`);
  });

  contract.on("EntityMoved", (_entityId: bigint, _dirCommitment: string, onChainMoveCounter: bigint) => {
    moveCounter = Number(onChainMoveCounter);
    console.log(`  [event] EntityMoved ${_entityId} mc=${moveCounter}`);
  });

  console.log("  Subscribed to chain events (Registered, Moved, Minted, EntityMoved).\n");
}

// Re-snapshot every 30s so a restart picks up close to the live tip.
// Cheaper than per-event writes (no burst thrashing) and the cushion
// inside saveSnapshot already absorbs a ~30s freshness gap.
function startSnapshotLoop(contractAddress: string): void {
  setInterval(async () => {
    try {
      const tip = await svc.provider.getBlockNumber();
      saveSnapshot(contractAddress, tip);
    } catch (err) {
      console.error(`  Snapshot loop tick failed: ${(err as Error).message}`);
    }
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  console.log("Initializing server...\n");

  // 1. Poseidon
  console.log("Loading Poseidon...");
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  console.log("  Poseidon ready.\n");

  // 2. ethers + oracle signer
  console.log("Loading ethers...");
  const oracleWallet = new Wallet(config.ORACLE_PRIVATE_KEY);
  const provider = buildProvider(config.RPC_URL);
  const oracleSigner = oracleWallet.connect(provider);
  console.log(`  Oracle address: ${oracleWallet.address}`);

  // Derive master secret for deterministic salt generation
  const masterSecret = BigInt(keccak256(
    concat([oracleWallet.privateKey, toUtf8Bytes("tallGrass")])
  ));
  console.log("  Master secret derived.\n");

  // 3. Encounter circuit + backend
  let encounterNoir: NoirInstance | null = null;
  let encounterBackend: BackendInstance | null = null;
  if (existsSync(config.ENCOUNTER_CIRCUIT_PATH)) {
    console.log("Loading encounter circuit...");
    const { Noir } = await import("@noir-lang/noir_js");
    const { UltraHonkBackend } = await import("@aztec/bb.js");
    const circuit = JSON.parse(readFileSync(config.ENCOUNTER_CIRCUIT_PATH, "utf-8"));
    encounterNoir = new Noir(circuit) as unknown as NoirInstance;
    encounterBackend = new UltraHonkBackend(circuit.bytecode) as unknown as BackendInstance;
    console.log("  Encounter circuit + backend ready.\n");
  } else {
    console.log(`  WARNING: Encounter circuit not found at ${config.ENCOUNTER_CIRCUIT_PATH}`);
    console.log("  Encounter proof generation will fail. Run: cd circuits && nargo compile\n");
  }

  // 4. FHE WASM + secret key
  let fheModule: TFHEModule | null = null;
  const tfheJsPath = join(config.FHE_DIST, "tfhe.js");
  const secretKeyPath = join(config.DATA_DIR, "secret.key");
  if (existsSync(tfheJsPath) && existsSync(secretKeyPath)) {
    console.log("Loading FHE WASM module...");
    const createTFHEModule = require(tfheJsPath) as (opts: { wasmBinary: Buffer }) => Promise<TFHEModule>;
    fheModule = await createTFHEModule({
      wasmBinary: readFileSync(join(config.FHE_DIST, "tfhe.wasm")),
    });

    const skData = readFileSync(secretKeyPath);
    const skPtr = fheModule._tfhe_malloc(skData.length);
    fheModule.HEAPU8.set(skData, skPtr);
    const rc = fheModule.ccall(
      "tfhe_load_secret_key", "number",
      ["number", "number"], [skPtr, skData.length]
    );
    fheModule._tfhe_free(skPtr);
    if (rc !== 0) throw new Error("Failed to load FHE secret key");
    console.log(`  FHE module ready (secret key: ${(skData.length / 1024).toFixed(0)} KB).\n`);
  } else {
    console.log("  WARNING: FHE files not found. Compare endpoint will fail.");
    console.log("  Run: cd fhe-wasm && ./build-native/keygen batch <seed> 32 7 ../app/data\n");
  }

  // 4b. Decryption circuit + backend
  let decryptionNoir: NoirInstance | null = null;
  let decryptionBackend: BackendInstance | null = null;
  if (existsSync(config.DECRYPTION_CIRCUIT_PATH)) {
    console.log("Loading decryption circuit...");
    const { Noir } = await import("@noir-lang/noir_js");
    const { UltraHonkBackend } = await import("@aztec/bb.js");
    const circuit = JSON.parse(readFileSync(config.DECRYPTION_CIRCUIT_PATH, "utf-8"));
    decryptionNoir = new Noir(circuit) as unknown as NoirInstance;
    decryptionBackend = new UltraHonkBackend(circuit.bytecode) as unknown as BackendInstance;
    console.log("  Decryption circuit + backend ready.\n");
  } else {
    console.log(`  WARNING: Decryption circuit not found at ${config.DECRYPTION_CIRCUIT_PATH}`);
    console.log("  Decryption proof generation will fail. Run: cd circuits && nargo compile\n");
  }

  // 4c. Extract LWE key bits and compute key commitment
  let lweKeyBits: number[] | null = null;
  let decryptionKeyCommitment: string | null = null;
  if (fheModule) {
    const n = fheModule.ccall("tfhe_get_lwe_dimension", "number", [], []);
    if (n === 500) {
      const keyBufSize = n * 4;
      const keyBufPtr = fheModule._tfhe_malloc(keyBufSize);
      const rc = fheModule.ccall(
        "tfhe_export_lwe_key_bits", "number",
        ["number", "number"], [keyBufPtr, keyBufSize]
      );
      if (rc === 0) {
        lweKeyBits = [];
        for (let i = 0; i < n; i++) {
          const val = fheModule.HEAPU8[keyBufPtr + i * 4]; // LE, 0 or 1
          lweKeyBits.push(val);
        }
        fheModule._tfhe_free(keyBufPtr);

        // Compute Poseidon key commitment: pack 500 bits into 2 Fields, hash
        let packedLo = 0n;
        let packedHi = 0n;
        for (let i = 0; i < 250; i++) {
          if (lweKeyBits[i]) packedLo |= 1n << BigInt(i);
        }
        for (let i = 0; i < 250; i++) {
          if (lweKeyBits[250 + i]) packedHi |= 1n << BigInt(i);
        }
        const poseidonTemp = poseidon([packedLo, packedHi]);
        decryptionKeyCommitment = toBytes32(poseidon.F.toObject(poseidonTemp));
        console.log(`  LWE key extracted (${n} bits). Key commitment: ${decryptionKeyCommitment.slice(0, 18)}...\n`);
      } else {
        fheModule._tfhe_free(keyBufPtr);
        console.log("  WARNING: Failed to extract LWE key bits.\n");
      }
    } else {
      console.log(`  WARNING: Unexpected LWE dimension ${n} (expected 500).\n`);
    }
  }

  // 4d. Load cached comparison proofs
  if (existsSync(config.COMPARISON_PROOFS_DIR)) {
    const { readdirSync, statSync } = await import("fs");
    const files = readdirSync(config.COMPARISON_PROOFS_DIR).filter(f => f.endsWith(".json") && f !== "manifest.json");
    for (const file of files) {
      try {
        const filePath = join(config.COMPARISON_PROOFS_DIR, file);
        const data = JSON.parse(readFileSync(filePath, "utf-8")) as ComparisonProofCache;
        if (data.revealedAt === undefined) {
          // Backfill from file mtime so legacy entries have a timestamp.
          data.revealedAt = statSync(filePath).mtimeMs;
        }
        if (data.revealer === undefined) data.revealer = "anon";
        const key = comparisonCacheKey(data.entityA, data.entityB, data.traitIndex);
        comparisonProofCache.set(key, data);
      } catch {
        // skip malformed cache entries
      }
    }
    if (comparisonProofCache.size > 0) {
      console.log(`  Loaded ${comparisonProofCache.size} cached comparison proofs.\n`);
    }
  }

  // 5. Manifest + Merkle data
  let manifestData: ManifestData | null = null;
  let merkleData: MerkleData | null = null;
  const manifestPath = join(config.DATA_DIR, "manifest.json");
  const merklePath = join(config.DATA_DIR, "merkle.json");
  if (existsSync(manifestPath)) {
    manifestData = JSON.parse(readFileSync(manifestPath, "utf-8")) as ManifestData;
    seed = BigInt("0x" + manifestData.seed);
    console.log(`  Manifest loaded: ${manifestData.entityCount} entities, seed=${manifestData.seed.slice(0, 8)}...\n`);
  } else {
    seed = 42n; // fallback for testing
    console.log("  WARNING: manifest.json not found. Using fallback seed.\n");
  }
  if (existsSync(merklePath)) {
    merkleData = JSON.parse(readFileSync(merklePath, "utf-8")) as MerkleData;
    console.log(`  Merkle tree loaded: root=${merkleData.root.slice(0, 18)}...\n`);
  } else {
    console.log("  WARNING: merkle.json not found. Encounter proofs will fail.\n");
  }

  // Assign services
  svc = {
    poseidon, oracleWallet, masterSecret,
    provider, contract: null, deployBlock: 0,
    encounterNoir, encounterBackend,
    decryptionNoir, decryptionBackend,
    fheModule, merkleData, manifestData,
    lweKeyBits, decryptionKeyCommitment,
  };

  // 6. Initialize entity positions
  initEntityPositions();
  console.log(`  Entity positions initialized (${config.ENTITY_COUNT} entities on ${config.GRID_WIDTH}x${config.GRID_HEIGHT} grid).\n`);

  // 7. Connect to deployed contract
  const deploymentPath = join(config.DEPLOYMENT_DIR, "TallGrass.json");
  if (existsSync(deploymentPath)) {
    const deployment = JSON.parse(readFileSync(deploymentPath, "utf-8")) as {
      address: string;
      abi: string[];
      receipt?: { blockNumber?: number };
    };
    const contract = new Contract(deployment.address, deployment.abi, oracleSigner);
    svc.contract = contract;
    svc.deployBlock = deployment.receipt?.blockNumber ?? 0;
    console.log(`  Contract connected at ${deployment.address} (deploy block ${svc.deployBlock})\n`);

    // 8. Recover state from chain + subscribe to live events
    await recoverFromChain(contract);
    subscribeToEvents(contract);
    startSnapshotLoop(deployment.address);
  } else {
    console.log("  WARNING: Contract deployment not found. Relay tx submission will fail.\n");
  }

  console.log("Server initialization complete.\n");
}

// ---------------------------------------------------------------------------
// API handlers — registration
// ---------------------------------------------------------------------------

async function handleRegister(body: string): Promise<ApiResponse> {
  const { address } = JSON.parse(body) as { address?: string };
  if (!address) return { status: 400, body: { error: "Missing address" } };

  const key = address.toLowerCase();
  if (participants.has(key)) {
    // If the in-memory entry has no matching on-chain commitment, the prior
    // register() tx never landed. Evict and let registration proceed so the
    // user isn't permanently locked out by a wallet-side failure.
    let stale = false;
    if (svc.contract) {
      try {
        const onChain = (await svc.contract.positionCommitments(address)) as string;
        if (onChain === ZeroHash) stale = true;
      } catch (e) {
        console.warn(`  [register] Chain check failed for ${key.slice(0, 8)}...:`, (e as Error).message);
      }
    }
    if (stale) {
      participants.delete(key);
      console.log(`  [register] Evicted stale entry for ${key.slice(0, 8)}...`);
    } else {
      return { status: 400, body: { error: "Already registered" } };
    }
  }

  const walkSecret = deriveWalkSecret(address);
  const { x, y } = deriveSpawn(walkSecret);
  const salt = deriveSalt(walkSecret, 0);
  const commitment = poseidonHash([BigInt(x), BigInt(y), salt]);
  const commitmentBytes32 = toBytes32(commitment);

  // Sign: keccak256(abi.encodePacked(address, commitment))
  const digest = solidityPackedKeccak256(
    ["address", "bytes32"],
    [address, commitmentBytes32]
  );
  const signature = await svc.oracleWallet.signMessage(getBytes(digest));

  participants.set(key, { x, y, salt, moveCount: 0, walkSecret });

  return {
    status: 200,
    body: {
      commitment: commitmentBytes32,
      signature,
      x,
      y,
      walkSecret: toBytes32(walkSecret),
      apiToken: deriveApiToken(address),
    },
  };
}

// ---------------------------------------------------------------------------
// API handlers — relay (oracle submits browser-generated proof)
// ---------------------------------------------------------------------------

async function handleRelay(body: string): Promise<ApiResponse> {
  const { address, proof, newCommitment } = JSON.parse(body) as {
    address?: string;
    proof?: string;
    newCommitment?: string;
  };
  if (!address || !proof || !newCommitment) {
    return { status: 400, body: { error: "Missing address, proof, or newCommitment" } };
  }

  const key = address.toLowerCase();
  const participant = participants.get(key);
  if (!participant) {
    return { status: 400, body: { error: "Not registered" } };
  }

  const contract = svc.contract;
  if (!contract) {
    return { status: 500, body: { error: "Contract not connected" } };
  }

  // Decode new position by brute-forcing 4 directions
  const newSalt = deriveSalt(participant.walkSecret, participant.moveCount + 1);
  let newX = -1;
  let newY = -1;
  const targetCommitment = BigInt(newCommitment);
  for (let dir = 0; dir < 4; dir++) {
    const { x: nx, y: ny } = applyMove(participant.x, participant.y, dir);
    const candidate = poseidonHash([BigInt(nx), BigInt(ny), newSalt]);
    if (candidate === targetCommitment) {
      newX = nx;
      newY = ny;
      break;
    }
  }

  if (newX < 0) {
    return { status: 400, body: { error: "Cannot decode new position from commitment" } };
  }

  // Submit relay tx, then optimistically advance in-memory state. Returning
  // before tx confirmation used to leave the oracle a poll-cycle behind on
  // its own moves (POLL_INTERVAL_MS = 12.5s); SPA's next /api/relay would
  // arrive within ~500ms with a commitment based on already-advanced state,
  // and brute-force against stale (x, y, moveCount) would 400.
  //
  // Optimistic safety: the brute-force decode above already proved the
  // commitment is reachable from current state via one of the four cardinal
  // moves, and the proof has been verified client-side. The relay tx can
  // still revert (network failure, gas spike, oracle's own balance issue);
  // if it does, we roll back to the snapshot below.
  try {
    const snapshotX = participant.x;
    const snapshotY = participant.y;
    const snapshotSalt = participant.salt;
    const snapshotMoveCount = participant.moveCount;
    const tx = await contract.relayMove(address, proof, newCommitment, { gasLimit: 3_000_000 }) as { hash: string; wait: () => Promise<{ status: number }> };

    // Optimistic advance — synchronous, before returning.
    moveCounter++;
    participant.moveCount = snapshotMoveCount + 1;
    participant.x = newX;
    participant.y = newY;
    participant.salt = newSalt;

    // Background: watch tx; roll back if it reverted. On success the event
    // listener may try to re-apply the same move; its `participant.moveCount
    // >= chainMC` guard absorbs that no-op.
    tx.wait().then((receipt) => {
      if (receipt.status !== 1) {
        console.error(`  Relay tx reverted for ${key.slice(0, 8)}... tx=${tx.hash.slice(0, 10)} — rolling back`);
        // Only roll back if no further moves landed in the meantime.
        if (participant.moveCount === snapshotMoveCount + 1) {
          moveCounter--;
          participant.x = snapshotX;
          participant.y = snapshotY;
          participant.salt = snapshotSalt;
          participant.moveCount = snapshotMoveCount;
        }
        return;
      }
      console.log(`  Confirmed move for ${key.slice(0, 8)}... -> (${newX},${newY}) tx=${tx.hash.slice(0, 10)}`);
    }).catch((e: Error) => {
      console.error(`  Relay tx watch failed for ${key.slice(0, 8)}...:`, e.message);
    });

    return { status: 200, body: { txHash: tx.hash } };
  } catch (e) {
    const msg = (e as Error).message;
    return { status: 500, body: { error: "Relay tx failed: " + msg } };
  }
}

// ---------------------------------------------------------------------------
// API handlers — encounter (after manual move)
// ---------------------------------------------------------------------------

async function handleEncounter(body: string): Promise<ApiResponse> {
  const { address, token } = JSON.parse(body) as { address?: string; token?: string };
  if (!address) return { status: 400, body: { error: "Missing address" } };
  if (!token) return { status: 400, body: { error: "Missing token" } };

  if (token !== deriveApiToken(address)) {
    return { status: 403, body: { error: "Invalid token" } };
  }

  const key = address.toLowerCase();
  const participant = participants.get(key);
  if (!participant) {
    return { status: 400, body: { error: "Not registered" } };
  }

  // Sync position from chain if contract is available
  const contract = svc.contract;
  if (contract) {
    try {
      const onChainCommitment = await contract.positionCommitments(address) as string;
      const localCommitment = toBytes32(poseidonHash([BigInt(participant.x), BigInt(participant.y), participant.salt]));
      if (onChainCommitment !== localCommitment) {
        // Position changed (manual move). Decode from chain.
        const onChainMoveCount = Number(await contract.participantMoveCount(address) as bigint);
        if (onChainMoveCount > participant.moveCount) {
          // Brute-force decode the new position
          const newSalt = deriveSalt(participant.walkSecret, onChainMoveCount);
          let found = false;
          for (let dir = 0; dir < 4; dir++) {
            const { x: nx, y: ny } = applyMove(participant.x, participant.y, dir);
            const candidate = poseidonHash([BigInt(nx), BigInt(ny), newSalt]);
            if (toBytes32(candidate) === onChainCommitment) {
              participant.x = nx;
              participant.y = ny;
              participant.salt = newSalt;
              participant.moveCount = onChainMoveCount;
              found = true;
              break;
            }
          }
          if (!found) {
            // Full replay if single-step decode fails
            const movedEvents = await queryFilterPaged(contract, contract.filters.Moved(address), svc.deployBlock);
            const sorted = movedEvents.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
            const parsed = sorted.map((e) => ({
              newCommitment: BigInt((e as unknown as { args: { newCommitment: string } }).args.newCommitment),
            }));
            const result = replayPositionMoves(
              Math.floor(config.GRID_WIDTH / 2), Math.floor(config.GRID_HEIGHT / 2),
              parsed, (i) => deriveSalt(participant.walkSecret, i),
            );
            if (result) {
              participant.x = result.x;
              participant.y = result.y;
              participant.salt = deriveSalt(participant.walkSecret, result.moveCount);
              participant.moveCount = result.moveCount;
            }
          }
        }
      }
    } catch (e) {
      console.warn(`  Encounter: chain sync failed for ${key.slice(0, 8)}...:`, (e as Error).message);
    }
  }

  // Check all unminted entities for co-location
  const encounters: Record<string, unknown>[] = [];
  for (let eid = 0; eid < config.ENTITY_COUNT; eid++) {
    if (mintedEntities.has(eid)) continue;
    const ep = entityPositions[eid];
    if (ep.x === participant.x && ep.y === participant.y) {
      // Verify on-chain before spending ~30s on proof generation
      if (contract) {
        const minted = await contract.entityMinted(eid) as boolean;
        if (minted) { mintedEntities.add(eid); continue; }
      }
      const encounterData = await generateEncounterProof(participant, eid);
      if (encounterData) {
        encounters.push({ entityId: eid, ...encounterData });
      }
    }
  }

  if (encounters.length > 0) {
    return { status: 200, body: { valid: true, encounters } };
  }

  const missBody: Record<string, unknown> = { valid: false };
  if (config.DEBUG) {
    missBody.participantPos = { x: participant.x, y: participant.y };
  }
  return { status: 200, body: missBody };
}

// ---------------------------------------------------------------------------
// API handlers — compare (FHE)
// ---------------------------------------------------------------------------

async function handleCompare(body: string): Promise<ApiResponse> {
  const fhe = svc.fheModule;
  if (!fhe) {
    return { status: 500, body: { error: "FHE module not loaded" } };
  }

  const { entityA, entityB, traitIndex, gt, eq, revealer } = JSON.parse(body) as {
    entityA?: number; entityB?: number; traitIndex?: number;
    gt?: string; eq?: string;
    revealer?: string;
  };
  if (!gt || !eq) {
    return { status: 400, body: { error: "Missing gt or eq field" } };
  }

  // Canonicalize: ensure entityA < entityB for cache key
  let canonA = entityA ?? -1;
  let canonB = entityB ?? -1;
  let canonTrait = traitIndex ?? -1;
  let flipped = false;
  if (canonA > canonB) {
    [canonA, canonB] = [canonB, canonA];
    flipped = true;
  }
  const hasIdentifiers = canonA >= 0 && canonB >= 0 && canonTrait >= 0;

  // Check cache
  if (hasIdentifiers) {
    const cacheKey = comparisonCacheKey(canonA, canonB, canonTrait);
    const cached = comparisonProofCache.get(cacheKey);
    if (cached) {
      let result = cached.result;
      if (flipped && result !== "=") result = result === ">" ? "<" : ">";
      return {
        status: 200,
        body: { result, proof: cached.proof, claimedGt: cached.claimedGt, claimedEq: cached.claimedEq },
      };
    }
  }

  // Decrypt
  const decryptBit = (ctHex: string): number => {
    const ctBytes = hexToBytes(ctHex);
    const ctPtr = fhe._tfhe_malloc(ctBytes.length);
    fhe.HEAPU8.set(ctBytes, ctPtr);
    const result = fhe.ccall(
      "tfhe_decrypt_bit", "number",
      ["number", "number"], [ctPtr, ctBytes.length]
    );
    fhe._tfhe_free(ctPtr);
    return result;
  };

  // When flipped, the browser sent gt(B,A) and eq(B,A).
  // gt(B,A)=1 means B>A. For canon (A<B), GT should be A>B = !gt(B,A) when not eq.
  // But FHE ops are done browser-side on (entityA, entityB) as passed.
  // If we flipped, the raw gt/eq ciphertexts represent (original entityA, original entityB).
  // Canon: (canonA, canonB) with canonA < canonB. If flipped, gt is gt(canonB, canonA).
  // We need to decrypt as-is and flip the final result.
  const gtBit = decryptBit(gt);
  const eqBit = decryptBit(eq);

  let result: string;
  if (eqBit === 1) result = "=";
  else if (gtBit === 1) result = ">";
  else result = "<";

  // Generate decryption proof if we have the circuit and key
  let proofHex: string | undefined;
  const claimedGt = gtBit === 1;
  const claimedEq = eqBit === 1;

  if (svc.decryptionNoir && svc.decryptionBackend && svc.lweKeyBits && svc.decryptionKeyCommitment) {
    try {
      const gtBytes = hexToBytes(gt);
      const eqBytes = hexToBytes(eq);
      const gtSample = parseLweSample(gtBytes);
      const eqSample = parseLweSample(eqBytes);

      // Build circuit inputs (noir_js: arrays as arrays, booleans as booleans)
      const inputs: Record<string, string | boolean | string[]> = {};

      // Private: secret key bits
      inputs["s"] = svc.lweKeyBits.map(String);

      // Public: GT sample
      inputs["gt_a"] = gtSample.a.map(String);
      inputs["gt_b"] = String(gtSample.b);

      // Public: EQ sample
      inputs["eq_a"] = eqSample.a.map(String);
      inputs["eq_b"] = String(eqSample.b);

      // Public: claimed results
      inputs["claimed_gt"] = claimedGt;
      inputs["claimed_eq"] = claimedEq;

      // Public: key commitment (as Field)
      inputs["key_commitment"] = String(BigInt(svc.decryptionKeyCommitment));

      console.log(`  Generating decryption proof...`);
      const t0 = performance.now();
      const { witness } = await svc.decryptionNoir.execute(inputs);
      const proofResult = await svc.decryptionBackend.generateProof(witness, { keccak: false });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`  Decryption proof generated in ${elapsed}s`);

      proofHex = bytesToHex(proofResult.proof);

      // Cache to disk if we have identifiers
      if (hasIdentifiers) {
        const cacheEntry: ComparisonProofCache = {
          entityA: canonA,
          entityB: canonB,
          traitIndex: canonTrait,
          // Store result in canonical direction (canonA vs canonB)
          result: flipped && result !== "=" ? (result === ">" ? "<" : ">") : result,
          claimedGt,
          claimedEq,
          proof: proofHex,
          revealedAt: Date.now(),
          revealer: revealer && /^0x[0-9a-fA-F]{40}$/.test(revealer) ? revealer.toLowerCase() : "anon",
        };
        const cacheKey = comparisonCacheKey(canonA, canonB, canonTrait);
        comparisonProofCache.set(cacheKey, cacheEntry);

        mkdirSync(config.COMPARISON_PROOFS_DIR, { recursive: true });
        writeFileSync(
          join(config.COMPARISON_PROOFS_DIR, `${canonA}_${canonB}_${canonTrait}.json`),
          JSON.stringify(cacheEntry, null, 2),
        );
      }
    } catch (e) {
      console.error("  Decryption proof generation failed:", (e as Error).message);
      // Return result without proof — comparison still works
    }
  }

  const responseBody: Record<string, unknown> = { result };
  if (proofHex) {
    responseBody.proof = proofHex;
    responseBody.claimedGt = claimedGt;
    responseBody.claimedEq = claimedEq;
  }

  return { status: 200, body: responseBody };
}

// ---------------------------------------------------------------------------
// API handlers — entity recovery
// ---------------------------------------------------------------------------

async function handleEntityRecover(url: string, body: string): Promise<ApiResponse> {
  const match = url.match(/^\/api\/entity\/(\d+)\/recover/);
  if (!match) return { status: 400, body: { error: "Invalid entity ID" } };

  const entityId = parseInt(match[1], 10);
  if (entityId < 0 || entityId >= config.ENTITY_COUNT) {
    return { status: 400, body: { error: `Invalid entityId (0-${config.ENTITY_COUNT - 1})` } };
  }

  const { signature, timestamp } = JSON.parse(body) as { signature?: string; timestamp?: number };
  if (!signature) {
    return { status: 400, body: { error: "Missing signature" } };
  }
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return { status: 400, body: { error: "Missing or invalid timestamp" } };
  }
  if (Math.abs(Date.now() - timestamp) > 60_000) {
    return { status: 400, body: { error: "Signature expired or timestamp out of range" } };
  }

  const contract = svc.contract;
  if (!contract) {
    return { status: 500, body: { error: "Contract not connected" } };
  }

  // Verify entity is minted
  const minted = await contract.entityMinted(entityId) as boolean;
  if (!minted) {
    return { status: 400, body: { error: "Entity not minted" } };
  }

  // Verify caller is the entity owner
  const message = `tall_grass:recover:${entityId}:${timestamp}`;
  let signer: string;
  try {
    signer = verifyMessage(message, signature);
  } catch {
    return { status: 400, body: { error: "Invalid signature" } };
  }

  const onChainOwner = await contract.ownerOf(entityId) as string;
  if (signer.toLowerCase() !== onChainOwner.toLowerCase()) {
    return { status: 403, body: { error: "Not entity owner" } };
  }

  const bSeed = deriveBlindingSeed(entityId);
  const onChainMoveCount = Number(await contract.entityMoveCount(entityId) as bigint);

  // Replay all EntityMoved events for this entity
  const movedEvents = await queryFilterPaged(
    contract,
    contract.filters.EntityMoved(entityId),
    svc.deployBlock,
  );

  const parsed = movedEvents.map((e) => ({
    directionCommitment: BigInt((e as unknown as { args: { directionCommitment: string } }).args.directionCommitment),
  }));
  const ePos = entityPositions[entityId];
  const result = replayEntityDirectionMoves(ePos.x, ePos.y, parsed, bSeed);

  if (!result) {
    return { status: 500, body: { error: "Cannot decode entity direction moves" } };
  }

  return {
    status: 200,
    body: {
      entityId,
      x: result.x,
      y: result.y,
      moveCount: onChainMoveCount,
      blindingSeed: toBytes32(bSeed),
    },
  };
}

// ---------------------------------------------------------------------------
// API handlers — state queries
// ---------------------------------------------------------------------------

async function handleState(url: string): Promise<ApiResponse> {
  const params = new URL(url, "http://localhost").searchParams;
  const address = params.get("address");
  if (!address) return { status: 400, body: { error: "Missing address" } };

  const key = address.toLowerCase();
  let participant = participants.get(key);

  // Cross-check chain: if in-memory entry exists but on-chain commitment is zero,
  // the user's register() tx never landed. Evict and report not-registered so the
  // dapp can re-trigger Enter. Fail-open on RPC error to avoid lockout during blips.
  if (participant && svc.contract) {
    try {
      const onChain = (await svc.contract.positionCommitments(address)) as string;
      if (onChain === ZeroHash) {
        participants.delete(key);
        participant = undefined;
        console.log(`  [state] Evicted stale entry for ${key.slice(0, 8)}... (no on-chain commitment)`);
      }
    } catch (e) {
      console.warn(`  [state] Chain check failed for ${key.slice(0, 8)}..., serving cached:`, (e as Error).message);
    }
  }

  if (!participant) {
    return {
      status: 200,
      body: { registered: false, x: null, y: null, moveCount: moveCounter, participantMoveCount: 0 },
    };
  }

  const stateBody: Record<string, unknown> = {
    registered: true,
    x: participant.x,
    y: participant.y,
    moveCount: moveCounter,
    participantMoveCount: participant.moveCount,
    walkSecret: toBytes32(participant.walkSecret),
    apiToken: deriveApiToken(address),
  };
  if (config.DEBUG) {
    stateBody.entityPositions = entityPositions.map(({ x, y }) => ({ x, y }));
  }

  return { status: 200, body: stateBody };
}

function handleReveals(url: string): ApiResponse {
  const params = new URL(url, "http://localhost").searchParams;
  const sinceParam = params.get("since");
  const since = sinceParam ? parseInt(sinceParam, 10) : 0;

  const reveals: Array<{
    a: number; b: number; trait: number;
    op: string; revealedAt: number; revealer: string;
  }> = [];
  for (const entry of comparisonProofCache.values()) {
    const ts = entry.revealedAt ?? 0;
    if (ts <= since) continue;
    reveals.push({
      a: entry.entityA,
      b: entry.entityB,
      trait: entry.traitIndex,
      op: entry.result,
      revealedAt: ts,
      revealer: entry.revealer ?? "anon",
    });
  }
  reveals.sort((x, y) => y.revealedAt - x.revealedAt);

  return {
    status: 200,
    body: {
      entityCount: config.ENTITY_COUNT,
      traitCount: 7,
      now: Date.now(),
      reveals,
    },
  };
}

function handleContract(): ApiResponse {
  const path = join(config.DEPLOYMENT_DIR, "TallGrass.json");
  if (!existsSync(path)) {
    return {
      status: 500,
      body: { error: "Contract not deployed. Run: cd contracts && npx hardhat deploy --tags TallGrass --network localhost" },
    };
  }
  const deployment = JSON.parse(readFileSync(path, "utf-8")) as { address: string; abi: string[] };
  const responseBody: Record<string, unknown> = { address: deployment.address, abi: deployment.abi };
  if (svc.decryptionKeyCommitment) {
    responseBody.decryptionKeyCommitment = svc.decryptionKeyCommitment;
  }
  return { status: 200, body: responseBody };
}

// ---------------------------------------------------------------------------
// Hono app + routes
// ---------------------------------------------------------------------------

const app = new Hono();

app.use("*", cors());
app.use("/api/*", bodyLimit({ maxSize: 64 * 1024 }));

function apiRoute(handler: (c: Context) => Promise<ApiResponse> | ApiResponse) {
  return async (c: Context) => {
    try {
      const result = await handler(c);
      return c.json(result.body, result.status as 200);
    } catch (e) {
      console.error(`Error handling ${c.req.path}:`, e);
      return c.json({ error: "Internal server error" }, 500);
    }
  };
}

// POST routes
app.post("/api/register", apiRoute(async (c) => handleRegister(await c.req.text())));
app.post("/api/relay", apiRoute(async (c) => handleRelay(await c.req.text())));
app.post("/api/encounter", apiRoute(async (c) => handleEncounter(await c.req.text())));
app.post("/api/compare", apiRoute(async (c) => await handleCompare(await c.req.text())));
app.post("/api/entity/:id/recover", apiRoute(async (c) => {
  return handleEntityRecover(c.req.path, await c.req.text());
}));

// GET routes
app.get("/api/state", apiRoute((c) => handleState(c.req.url)));
app.get("/api/contract", apiRoute(() => handleContract()));
app.get("/api/reveals", apiRoute((c) => handleReveals(c.req.url)));

// Strict allowlist for /data/*. DATA_DIR holds operational artifacts the
// oracle reads on boot (secret.key, manifest.json with plaintext traits and
// landscape seed, merkle.json) — these must NEVER be served. Only the
// ciphertexts and circuit artifacts the SPA actually needs are exposed.
//
// Everything allowlisted is bound to the deployment by on-chain commitments
// and never changes, so we tag it immutable and skip revalidation.
const PUBLIC_DATA_PATHS = new Set([
  "/data/cloud.key",
  "/data/tfhe.js",
  "/data/tfhe.wasm",
  "/data/movement.json",
  "/data/decryption.json",
]);
app.use("/data/*", async (c, next) => {
  const path = c.req.path;
  const isEntityCiphertext = /^\/data\/entities\/\d+\.bin$/.test(path);
  if (!isEntityCiphertext && !PUBLIC_DATA_PATHS.has(path)) {
    return c.notFound();
  }
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  await next();
});

// Static: /data/tfhe.* — FHE WASM from fhe-wasm/dist/ (before general /data/*)
app.get("/data/tfhe.js", serveStatic({ root: config.FHE_DIST, rewriteRequestPath: () => "/tfhe.js" }));
app.get("/data/tfhe.wasm", serveStatic({ root: config.FHE_DIST, rewriteRequestPath: () => "/tfhe.wasm" }));

// Static: circuit artifacts for browser proving/verification
app.get("/data/movement.json", serveStatic({
  root: config.CIRCUITS_TARGET_DIR,
  rewriteRequestPath: () => "/movement.json",
}));
app.get("/data/decryption.json", serveStatic({
  root: config.CIRCUITS_TARGET_DIR,
  rewriteRequestPath: () => "/decryption.json",
}));

// Static: /data/* — FHE batch output
app.use("/data/*", serveStatic({
  root: config.DATA_DIR,
  rewriteRequestPath: (path) => path.replace(/^\/data/, ""),
}));

// Static: /* — Vite build output (production SPA).
// Skipped on hosts where the SPA lives elsewhere (e.g. Netlify) and dist/ is absent.
if (existsSync(config.DIST_DIR)) {
  app.use("*", serveStatic({ root: config.DIST_DIR }));
  app.get("*", serveStatic({ root: config.DIST_DIR, rewriteRequestPath: () => "/index.html" }));
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init()
  .then(() => {
    serve({ fetch: app.fetch, port: config.PORT }, (info) => {
      console.log(`Server listening on http://localhost:${info.port}`);
      console.log(`\nAPI endpoints:`);
      console.log(`  POST /api/register        — Register participant`);
      console.log(`  POST /api/relay           — Relay browser-generated proof`);
      console.log(`  POST /api/encounter       — Check encounter (after manual move)`);
      console.log(`  POST /api/compare         — Decrypt FHE comparison`);
      console.log(`  GET  /api/state           — Get participant state`);
      console.log(`  GET  /api/contract        — Get contract address + ABI`);
      console.log(`  POST /api/entity/:id/recover — Recover entity position (owner-signed)`);
      console.log(`\nStatic files:`);
      console.log(`  /data/*               — FHE batch data + WASM + circuit artifacts`);
      console.log();
    });
  })
  .catch((e: Error) => {
    console.error("Server initialization failed:", e);
    process.exit(1);
  });
