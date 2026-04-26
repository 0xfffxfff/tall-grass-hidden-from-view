#!/usr/bin/env node
/**
 * Full functional integration test:
 *   register → deposit → navigate (relay, browser-side proofs) → encounter → mint
 *   → restart (chain recovery) → move after restart
 *   → transfer NFT → recover secrets → move entity (ZK proof)
 *   → FHE comparison + decryption proof generation + ZK verification
 *
 * Prerequisites (three terminals):
 *   1. anvil
 *   2. cd contracts && npx hardhat deploy --tags TallGrass --network localhost
 *   3. cd app && npx tsx server.ts
 *
 * Or: make deploy-local  (handles 1+2)
 *     make start-server   (handles 3)
 *     make test-integration
 *
 * Uses `cast` (Foundry) for on-chain calls — no extra Node dependencies.
 */

import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVER = process.env.SERVER_URL || "http://localhost:3000";
const RPC = process.env.RPC_URL || "http://localhost:8545";
const GRID = 32;

// Hardhat account #1 (account #0 is deployer/oracle)
const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const PRIVKEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// Hardhat account #2 (NFT transfer recipient)
const ACCOUNT2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PRIVKEY2 =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

// Direction deltas matching circuit convention (lib/src/grid.nr):
//   0 = North (y+1), 1 = South (y-1), 2 = East (x+1), 3 = West (x-1)
const DIR_DELTAS = [
  [0, 1],   // 0: North (y+1)
  [0, -1],  // 1: South (y-1)
  [1, 0],   // 2: East  (x+1)
  [-1, 0],  // 3: West  (x-1)
];
const DIR_NAMES = ["North", "South", "East", "West"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Gas limit to bypass eth_estimateGas (cast+anvil compat issue with duplicate data field)
const GAS_LIMIT = "3000000";

function cast(cmd) {
  const full = `cast ${cmd} --rpc-url ${RPC}`;
  try {
    return execSync(full, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    console.error(`\n  cast failed: ${full}`);
    console.error(`  ${e.stderr?.trim() || e.message}`);
    process.exit(1);
  }
}

function castSend(contract, sig, args, opts = "", key = PRIVKEY) {
  return cast(
    `send ${contract} "${sig}" ${args} --private-key ${key} --gas-limit ${GAS_LIMIT} ${opts}`
  );
}

function castSign(message, key) {
  const cmd = `cast wallet sign --private-key ${key} "${message}"`;
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    console.error(`\n  cast sign failed: ${cmd}`);
    console.error(`  ${e.stderr?.trim() || e.message}`);
    process.exit(1);
  }
}

function toBytes32(n) {
  return "0x" + BigInt(n).toString(16).padStart(64, "0");
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.slice(i, i + 2), 16);
  }
  return bytes;
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SERVER}${path}`, opts);
  const json = await res.json();
  if (res.status !== 200) {
    throw new Error(`${path} returned ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function wrap(v, max) {
  return ((v % max) + max) % max;
}

// Compute directions to navigate from (px,py) to (tx,ty) on toroidal grid.
// Uses circuit direction convention: 0=North(y+1)  1=South(y-1)  2=East(x+1)  3=West(x-1)
function computePath(px, py, tx, ty) {
  const dirs = [];

  // X movement
  const rawDx = ((tx - px) + GRID) % GRID;
  if (rawDx <= GRID / 2) {
    for (let i = 0; i < rawDx; i++) dirs.push(2); // East (x+1)
  } else {
    for (let i = 0; i < GRID - rawDx; i++) dirs.push(3); // West (x-1)
  }

  // Y movement
  const rawDy = ((ty - py) + GRID) % GRID;
  if (rawDy <= GRID / 2) {
    for (let i = 0; i < rawDy; i++) dirs.push(0); // North (y+1)
  } else {
    for (let i = 0; i < GRID - rawDy; i++) dirs.push(1); // South (y-1)
  }

  return dirs;
}

function manhattanDist(px, py, tx, ty) {
  const dx = Math.min(((tx - px) + GRID) % GRID, ((px - tx) + GRID) % GRID);
  const dy = Math.min(((ty - py) + GRID) % GRID, ((py - ty) + GRID) % GRID);
  return dx + dy;
}

function step(msg) {
  console.log(`\n==> ${msg}`);
}

function info(msg) {
  console.log(`    ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const ROOT_DIR = resolve(__dirname, "../..");
const PID_FILE = resolve(ROOT_DIR, ".server.pid");

async function restartServer() {
  // 1. Read PID and send SIGTERM
  const oldPid = readFileSync(PID_FILE, "utf-8").trim();
  info(`Sending SIGTERM to server PID ${oldPid}`);
  try {
    process.kill(Number(oldPid), "SIGTERM");
  } catch (e) {
    info(`  (kill returned: ${e.message})`);
  }

  // 2. Poll until server stops responding (port freed)
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${SERVER}/api/contract`);
      await sleep(200);
    } catch {
      break; // connection refused — server is down
    }
  }
  // Small extra wait for port to fully release
  await sleep(500);

  // 3. Spawn new server process
  info("Spawning new server process...");
  const { openSync } = await import("fs");
  const logFd = openSync(resolve(ROOT_DIR, ".server.log"), "a");
  const child = spawn("npx", ["tsx", "app/server.ts"], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, DEBUG: "1" },
  });
  child.unref();

  // 4. Write new PID so Makefile cleanup still works
  writeFileSync(PID_FILE, String(child.pid));
  info(`New server PID: ${child.pid}`);

  // 5. Poll until /api/contract responds
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${SERVER}/api/contract`);
      if (res.ok) {
        info("Server is ready.");
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error("Server failed to start after restart");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Tall Grass — Integration Test");
  console.log("=".repeat(50));

  // 0. Load proving infrastructure
  step("Loading proving infrastructure");
  const { buildPoseidon } = await import("circomlibjs");
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");

  const poseidon = await buildPoseidon();
  const ph = (inputs) => poseidon.F.toObject(poseidon(inputs));

  const movementCircuitPath = resolve(__dirname, "../../circuits/target/movement.json");
  const movementCircuit = JSON.parse(readFileSync(movementCircuitPath, "utf-8"));
  const movementNoir = new Noir(movementCircuit);
  const movementBackend = new UltraHonkBackend(movementCircuit.bytecode);
  info("Movement circuit loaded");

  // Helper: generate movement proof
  async function generateMoveProof(fromX, fromY, dir, ws, mc) {
    const [dx, dy] = DIR_DELTAS[dir];
    const newX = wrap(fromX + dx, GRID);
    const newY = wrap(fromY + dy, GRID);

    const oldSalt = ph([ws, BigInt(mc)]);
    const newSalt = ph([ws, BigInt(mc + 1)]);
    const oldCommitment = ph([BigInt(fromX), BigInt(fromY), oldSalt]);
    const newCommitment = ph([BigInt(newX), BigInt(newY), newSalt]);

    const inputs = {
      old_x: String(fromX),
      old_y: String(fromY),
      old_salt: oldSalt.toString(),
      new_x: String(newX),
      new_y: String(newY),
      new_salt: newSalt.toString(),
      direction: String(dir),
      old_commitment: toBytes32(oldCommitment),
      new_commitment: toBytes32(newCommitment),
      grid_width: String(GRID),
      grid_height: String(GRID),
    };

    const { witness } = await movementNoir.execute(inputs);
    const proofResult = await movementBackend.generateProof(witness, { keccak: true });
    const proofHex = "0x" + bytesToHex(proofResult.proof);

    return { proofHex, newX, newY, newCommitmentHex: toBytes32(newCommitment) };
  }

  // 1. Read contract address
  const deploymentPath = resolve(
    __dirname, "../../contracts/deployments/localhost/TallGrass.json"
  );
  let deployment;
  try {
    deployment = JSON.parse(readFileSync(deploymentPath, "utf-8"));
  } catch {
    console.error(
      `\nContract deployment not found at ${deploymentPath}` +
      `\nRun: make deploy-local`
    );
    process.exit(1);
  }
  const CONTRACT = deployment.address;
  info(`Contract: ${CONTRACT}`);
  info(`Account:  ${ACCOUNT}`);
  info(`Server:   ${SERVER}`);

  // 2. Register
  step("Registering participant");
  const reg = await api("POST", "/api/register", { address: ACCOUNT });
  info(`Position: (${reg.x}, ${reg.y})`);
  info(`Commitment: ${reg.commitment.slice(0, 18)}...`);
  info(`Walk secret: ${reg.walkSecret.slice(0, 18)}...`);
  info(`API token: ${reg.apiToken.slice(0, 18)}...`);
  const apiToken = reg.apiToken;

  castSend(CONTRACT, "register(bytes32,bytes)", `${reg.commitment} ${reg.signature}`);
  const isRegistered = cast(`call ${CONTRACT} "isParticipant(address)(bool)" ${ACCOUNT}`);
  info(`On-chain registered: ${isRegistered}`);

  const walkSecret = BigInt(reg.walkSecret);

  // 3. Get entity positions and find nearest
  step("Finding nearest entity");
  const state = await api("GET", `/api/state?address=${ACCOUNT}`);
  const entities = state.entityPositions;

  let nearest = { id: -1, dist: Infinity };
  for (let i = 0; i < entities.length; i++) {
    const d = manhattanDist(reg.x, reg.y, entities[i].x, entities[i].y);
    if (d < nearest.dist) {
      nearest = { id: i, dist: d, ...entities[i] };
    }
  }
  info(`Entity ${nearest.id} at (${nearest.x}, ${nearest.y}) — ${nearest.dist} moves away`);

  // 4. Deposit for relay
  step("Depositing for relay");
  castSend(CONTRACT, "deposit()", "", "--value 1ether");
  const depositBal = cast(`call ${CONTRACT} "depositBalance(address)(uint256)" ${ACCOUNT}`);
  info(`Deposit balance: ${depositBal}`);

  // 5. Navigate to entity via relay (browser-side proofs)
  const path = computePath(reg.x, reg.y, nearest.x, nearest.y);
  step(`Navigating to entity (${path.length} moves via relay)`);

  let curX = reg.x, curY = reg.y;
  let moveCount = 0;

  for (let i = 0; i < path.length; i++) {
    const dir = path[i];
    const t0 = performance.now();

    const move = await generateMoveProof(curX, curY, dir, walkSecret, moveCount);

    await api("POST", "/api/relay", {
      address: ACCOUNT,
      proof: move.proofHex,
      newCommitment: move.newCommitmentHex,
    });

    curX = move.newX;
    curY = move.newY;
    moveCount++;

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    info(`[${i + 1}/${path.length}] ${DIR_NAMES[dir]} → (${curX}, ${curY}) (${elapsed}s)`);
  }

  // 6. Verify on-chain move count
  const onChainMoves = cast(`call ${CONTRACT} "participantMoveCount(address)(uint256)" ${ACCOUNT}`);
  info(`On-chain move count: ${onChainMoves}`);

  // 7. Encounter (server syncs from chain via /api/encounter)
  step("Checking encounter");
  const encounterResult = await api("POST", "/api/encounter", { address: ACCOUNT, token: apiToken });
  if (!encounterResult.valid || !encounterResult.encounters?.length) {
    console.error(`\n  Encounter failed — no entity at position (${curX}, ${curY})!`);
    if (encounterResult.participantPos) {
      console.error(`  Server thinks participant is at (${encounterResult.participantPos.x}, ${encounterResult.participantPos.y})`);
    }
    process.exit(1);
  }
  const encounter = encounterResult.encounters[0];
  info(`Encounter valid for entity ${encounter.entityId}`);
  info(`Encounter proof: ${encounter.encounterProof.slice(0, 18)}...`);
  info(`Trait hash: ${encounter.entityTraitHash.slice(0, 18)}...`);
  info(`Merkle proof: ${encounter.traitMerkleProof.length} nodes`);

  // 8. Mint
  step("Minting entity");
  const proofArray =
    "[" + encounter.traitMerkleProof.join(",") + "]";

  castSend(
    CONTRACT,
    "mint(uint256,bytes,bytes32,bytes32,bytes32,bytes32[])",
    `${encounter.entityId} ${encounter.encounterProof} ${encounter.entityTraitHash} ${encounter.initialPositionCommitment} ${encounter.blindingSeedCommitment} "${proofArray}"`,
    "--value 0.2ether"
  );

  // 9. Verify mint
  step("Verifying on-chain state");
  const owner = cast(`call ${CONTRACT} "ownerOf(uint256)(address)" ${encounter.entityId}`);
  const minted = cast(`call ${CONTRACT} "entityMinted(uint256)(bool)" ${encounter.entityId}`);
  const totalMinted = cast(`call ${CONTRACT} "totalMinted()(uint256)" `);
  const traitHash = cast(`call ${CONTRACT} "entityTraitHash(uint256)(bytes32)" ${encounter.entityId}`);

  info(`Entity ${encounter.entityId} owner: ${owner}`);
  info(`Entity minted: ${minted}`);
  info(`Total minted: ${totalMinted}`);
  info(`Trait hash: ${traitHash.slice(0, 18)}...`);

  const ownerMatch = owner.toLowerCase() === ACCOUNT.toLowerCase();
  if (!ownerMatch) {
    console.error(`\n  Owner mismatch! Expected ${ACCOUNT}, got ${owner}`);
    process.exit(1);
  }

  // 10. Verify entity state (post-mint)
  step("Verifying entity state");
  const entityPosCommitment = cast(`call ${CONTRACT} "entityPositionCommitments(uint256)(bytes32)" ${encounter.entityId}`);
  const entityBscCommitment = cast(`call ${CONTRACT} "entityBlindingSeedCommitments(uint256)(bytes32)" ${encounter.entityId}`);
  const entityMoveCount = cast(`call ${CONTRACT} "entityMoveCount(uint256)(uint256)" ${encounter.entityId}`);
  info(`Position commitment: ${entityPosCommitment.slice(0, 18)}...`);
  info(`Blinding seed commitment: ${entityBscCommitment.slice(0, 18)}...`);
  info(`Entity move count: ${entityMoveCount}`);

  if (entityPosCommitment !== encounter.initialPositionCommitment) {
    console.error(`  Position commitment mismatch!`);
    process.exit(1);
  }
  if (entityBscCommitment !== encounter.blindingSeedCommitment) {
    console.error(`  Blinding seed commitment mismatch!`);
    process.exit(1);
  }
  info("Commitments match encounter proof.");

  // -- Snapshot values to verify after restart --
  const preRestartState = {
    x: curX,
    y: curY,
    moveCount,
    entityId: encounter.entityId,
  };

  // 11. Restart server (chain recovery)
  step("Restarting server (chain recovery)");
  await restartServer();

  // 12. Verify state survived restart
  step("Verifying state after restart");
  const postRestartState = await api("GET", `/api/state?address=${ACCOUNT}`);
  if (!postRestartState.registered) {
    console.error("  Participant not registered after restart!");
    process.exit(1);
  }
  if (postRestartState.x !== preRestartState.x || postRestartState.y !== preRestartState.y) {
    console.error(`  Position mismatch after restart! Expected (${preRestartState.x}, ${preRestartState.y}), got (${postRestartState.x}, ${postRestartState.y})`);
    process.exit(1);
  }
  if (postRestartState.participantMoveCount !== preRestartState.moveCount) {
    console.error(`  Move count mismatch after restart! Expected ${preRestartState.moveCount}, got ${postRestartState.participantMoveCount}`);
    process.exit(1);
  }
  info(`Position: (${postRestartState.x}, ${postRestartState.y}) — matches pre-restart`);
  info(`Move count: ${postRestartState.participantMoveCount} — matches`);

  // 13. Move after restart (relay)
  step("Moving after restart (via relay)");
  const postRestartMove = await generateMoveProof(curX, curY, 0, walkSecret, moveCount);
  const postRestartResult = await api("POST", "/api/relay", {
    address: ACCOUNT,
    proof: postRestartMove.proofHex,
    newCommitment: postRestartMove.newCommitmentHex,
  });
  info(`Relay tx: ${postRestartResult.txHash.slice(0, 18)}...`);

  curX = postRestartMove.newX;
  curY = postRestartMove.newY;
  moveCount++;

  const postRestartMoveCount = cast(`call ${CONTRACT} "participantMoveCount(address)(uint256)" ${ACCOUNT}`);
  info(`Position: (${curX}, ${curY})`);
  info(`On-chain move count: ${postRestartMoveCount}`);
  if (Number(postRestartMoveCount) !== moveCount) {
    console.error(`  Move count mismatch! Expected ${moveCount}, got ${postRestartMoveCount}`);
    process.exit(1);
  }

  // 14. Transfer NFT to account #2
  step("Transferring entity NFT to account #2");
  castSend(
    CONTRACT,
    "transferFrom(address,address,uint256)",
    `${ACCOUNT} ${ACCOUNT2} ${encounter.entityId}`
  );
  const newOwner = cast(`call ${CONTRACT} "ownerOf(uint256)(address)" ${encounter.entityId}`);
  info(`New owner: ${newOwner}`);
  if (newOwner.toLowerCase() !== ACCOUNT2.toLowerCase()) {
    console.error(`  Transfer failed! Expected ${ACCOUNT2}, got ${newOwner}`);
    process.exit(1);
  }

  // 15. Old owner cannot recover entity secrets
  step("Verifying old owner cannot recover entity");
  const oldOwnerSig = castSign(`tall_grass:recover:${encounter.entityId}`, PRIVKEY);
  try {
    await api("POST", `/api/entity/${encounter.entityId}/recover`, { signature: oldOwnerSig });
    console.error("  Old owner recovered entity — should have been rejected!");
    process.exit(1);
  } catch (e) {
    if (!e.message.includes("403")) {
      console.error(`  Unexpected error: ${e.message}`);
      process.exit(1);
    }
    info("Old owner correctly rejected (403).");
  }

  // 16. New owner recovers entity secrets via oracle
  step("Recovering entity secrets as new owner");
  const newOwnerSig = castSign(`tall_grass:recover:${encounter.entityId}`, PRIVKEY2);
  const recovery = await api("POST", `/api/entity/${encounter.entityId}/recover`, { signature: newOwnerSig });
  info(`Entity position: (${recovery.x}, ${recovery.y})`);
  info(`Blinding seed: ${recovery.blindingSeed.slice(0, 18)}...`);
  info(`Move count: ${recovery.moveCount}`);

  // 17. Move entity as new owner (entity movement ZK proof)
  step("Moving entity as new owner (entity movement ZK proof)");

  const entityCircuitPath = resolve(__dirname, "../../circuits/target/entity_movement.json");
  const entityCircuit = JSON.parse(readFileSync(entityCircuitPath, "utf-8"));
  const entityNoir = new Noir(entityCircuit);
  const entityBackend = new UltraHonkBackend(entityCircuit.bytecode);

  // Compute entity movement inputs (direction 0 = North = y+1)
  const blindingSeed = BigInt(recovery.blindingSeed);
  const eMoveCount = recovery.moveCount; // 0
  const eOldX = recovery.x;
  const eOldY = recovery.y;
  const eDir = 0; // North (y+1)
  const eNewX = eOldX;
  const eNewY = (eOldY + 1) % GRID;

  const eOldSalt = ph([blindingSeed, BigInt(eMoveCount), 0n]);
  const eNewSalt = ph([blindingSeed, BigInt(eMoveCount + 1), 0n]);
  const eOldCommitment = ph([BigInt(eOldX), BigInt(eOldY), eOldSalt]);
  const eNewCommitment = ph([BigInt(eNewX), BigInt(eNewY), eNewSalt]);
  const eBscCommitment = ph([blindingSeed]);
  const eBlinding = ph([blindingSeed, BigInt(eMoveCount)]);
  const eDirCommitment = ph([BigInt(eDir), eBlinding]);

  info(`Moving entity from (${eOldX}, ${eOldY}) to (${eNewX}, ${eNewY})`);

  const entityInputs = {
    old_x: String(eOldX),
    old_y: String(eOldY),
    new_x: String(eNewX),
    new_y: String(eNewY),
    direction: String(eDir),
    blinding_seed: String(blindingSeed),
    old_commitment: String(eOldCommitment),
    new_commitment: String(eNewCommitment),
    grid_width: String(GRID),
    grid_height: String(GRID),
    direction_commitment: String(eDirCommitment),
    blinding_seed_commitment: String(eBscCommitment),
    entity_move_count: String(eMoveCount),
  };

  const et0 = performance.now();
  const { witness: eWitness } = await entityNoir.execute(entityInputs);
  const eProofResult = await entityBackend.generateProof(eWitness, { keccak: true });
  const eElapsed = ((performance.now() - et0) / 1000).toFixed(1);
  info(`Entity movement proof generated in ${eElapsed}s`);

  // Submit moveEntity on-chain as account #2
  const eProofHex = "0x" + bytesToHex(eProofResult.proof);
  const eNewCommitmentHex = toBytes32(eNewCommitment);
  const eDirCommitmentHex = toBytes32(eDirCommitment);

  castSend(
    CONTRACT,
    "moveEntity(uint256,bytes,bytes32,bytes32)",
    `${encounter.entityId} ${eProofHex} ${eNewCommitmentHex} ${eDirCommitmentHex}`,
    "",
    PRIVKEY2
  );

  // 18. Verify entity moved on-chain
  step("Verifying entity movement on-chain");
  const newEntityMoveCount = cast(`call ${CONTRACT} "entityMoveCount(uint256)(uint256)" ${encounter.entityId}`);
  const newEntityPosCommitment = cast(`call ${CONTRACT} "entityPositionCommitments(uint256)(bytes32)" ${encounter.entityId}`);
  info(`Entity move count: ${newEntityMoveCount}`);
  info(`New position commitment: ${newEntityPosCommitment.slice(0, 18)}...`);
  if (Number(newEntityMoveCount) !== eMoveCount + 1) {
    console.error(`  Entity move count did not increment! Expected ${eMoveCount + 1}, got ${newEntityMoveCount}`);
    process.exit(1);
  }
  if (newEntityPosCommitment !== eNewCommitmentHex) {
    console.error(`  Position commitment mismatch! Expected ${eNewCommitmentHex.slice(0, 18)}..., got ${newEntityPosCommitment.slice(0, 18)}...`);
    process.exit(1);
  }
  info("Entity movement verified on-chain.");

  // 19. FHE comparison + decryption proof verification
  step("FHE comparison + decryption proof verification");

  const FHE_DATA_DIR = resolve(__dirname, "../../app/data");
  const FHE_DIST_DIR = resolve(__dirname, "../../fhe-wasm/dist");
  const fheManifest = JSON.parse(readFileSync(resolve(FHE_DATA_DIR, "manifest.json"), "utf-8"));

  // Load FHE WASM with cloud key for homomorphic comparison
  // Note: load tfhe.js from fhe-wasm/dist/ (CJS) — app/data/ is under "type":"module" scope
  info("Loading FHE WASM module + cloud key...");
  const createTFHE = createRequire(import.meta.url)(resolve(FHE_DIST_DIR, "tfhe.js"));
  const fhe = await createTFHE({
    wasmBinary: readFileSync(resolve(FHE_DIST_DIR, "tfhe.wasm")),
  });

  const ckData = readFileSync(resolve(FHE_DATA_DIR, "cloud.key"));
  const ckPtr = fhe._tfhe_malloc(ckData.length);
  fhe.HEAPU8.set(ckData, ckPtr);
  if (fhe.ccall("tfhe_load_cloud_key", "number", ["number", "number"], [ckPtr, ckData.length]) !== 0) {
    console.error("  Failed to load FHE cloud key");
    process.exit(1);
  }
  fhe._tfhe_free(ckPtr);
  info(`Cloud key loaded (${(ckData.length / 1024 / 1024).toFixed(0)} MB)`);

  // Extract single-trait ciphertexts for entities 0 and 1
  const LWE_SAMPLE_SIZE = 2016;
  const TRAIT_CT_SIZE = LWE_SAMPLE_SIZE * 8; // 8 LweSamples per 8-bit value
  const compareTraitIdx = 0;

  const ct0 = readFileSync(resolve(FHE_DATA_DIR, "entities/0.bin"));
  const ct1 = readFileSync(resolve(FHE_DATA_DIR, "entities/1.bin"));
  const traitA = ct0.slice(compareTraitIdx * TRAIT_CT_SIZE, (compareTraitIdx + 1) * TRAIT_CT_SIZE);
  const traitB = ct1.slice(compareTraitIdx * TRAIT_CT_SIZE, (compareTraitIdx + 1) * TRAIT_CT_SIZE);

  // Homomorphic GT and EQ comparison
  function fheCompare(fn, a, b) {
    const aPtr = fhe._tfhe_malloc(a.length);
    fhe.HEAPU8.set(a, aPtr);
    const bPtr = fhe._tfhe_malloc(b.length);
    fhe.HEAPU8.set(b, bPtr);
    const outLenPtr = fhe._tfhe_malloc(4);

    const outPtr = fhe.ccall(fn, "number",
      ["number", "number", "number", "number", "number"],
      [aPtr, a.length, bPtr, b.length, outLenPtr]);

    const outLen = fhe.HEAPU8[outLenPtr] | (fhe.HEAPU8[outLenPtr + 1] << 8) |
                   (fhe.HEAPU8[outLenPtr + 2] << 16) | (fhe.HEAPU8[outLenPtr + 3] << 24);
    fhe._tfhe_free(aPtr);
    fhe._tfhe_free(bPtr);
    fhe._tfhe_free(outLenPtr);

    if (!outPtr || outLen === 0) throw new Error(`${fn} failed`);
    const result = fhe.HEAPU8.slice(outPtr, outPtr + outLen);
    fhe._tfhe_free(outPtr);
    return result;
  }

  const t0Fhe = performance.now();
  info("Computing FHE GT comparison...");
  const encGt = fheCompare("tfhe_compare_gt", traitA, traitB);
  info("Computing FHE EQ comparison...");
  const encEq = fheCompare("tfhe_compare_eq", traitA, traitB);
  const fheElapsed = ((performance.now() - t0Fhe) / 1000).toFixed(1);
  info(`FHE comparisons done in ${fheElapsed}s (GT: ${encGt.length}B, EQ: ${encEq.length}B)`);

  // Send encrypted results to oracle for decryption + proof
  const compareResult = await api("POST", "/api/compare", {
    entityA: 0,
    entityB: 1,
    traitIndex: compareTraitIdx,
    gt: bytesToHex(encGt),
    eq: bytesToHex(encEq),
  });
  info(`Result: entity 0 ${compareResult.result} entity 1 (trait ${compareTraitIdx})`);

  // Verify against ground truth from manifest
  const valA = fheManifest.entities[0].traits[compareTraitIdx];
  const valB = fheManifest.entities[1].traits[compareTraitIdx];
  const expectedCmp = valA > valB ? ">" : valA === valB ? "=" : "<";
  if (compareResult.result !== expectedCmp) {
    console.error(`  Result mismatch! Expected ${expectedCmp} (${valA} vs ${valB}), got ${compareResult.result}`);
    process.exit(1);
  }
  info(`Ground truth verified: ${valA} ${expectedCmp} ${valB}`);

  if (!compareResult.proof) {
    console.error("  No decryption proof in response!");
    process.exit(1);
  }
  info(`Proof: ${compareResult.proof.slice(0, 36)}...`);
  info(`Claimed GT: ${compareResult.claimedGt}, Claimed EQ: ${compareResult.claimedEq}`);

  // 20. Verify decryption proof (ZK)
  step("Verifying decryption proof");

  const decryptionCircuitPath = resolve(__dirname, "../../circuits/target/decryption.json");
  const decryptionCircuit = JSON.parse(readFileSync(decryptionCircuitPath, "utf-8"));
  const decryptionBackend = new UltraHonkBackend(decryptionCircuit.bytecode);

  // Read on-chain key commitment
  const onChainKeyCommitment = cast(`call ${CONTRACT} "decryptionKeyCommitment()(bytes32)"`);
  info(`On-chain key commitment: ${onChainKeyCommitment.slice(0, 18)}...`);

  // Parse LWE samples from encrypted comparison results
  function parseLweSample(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const a = [];
    let offset = 4; // skip 4-byte UID
    for (let i = 0; i < 500; i++) {
      a.push(view.getUint32(offset, true));
      offset += 4;
    }
    const b = view.getUint32(offset, true);
    return { a, b };
  }

  function toHex32(n) {
    return "0x" + BigInt(n).toString(16).padStart(64, "0");
  }

  const gtSample = parseLweSample(encGt);
  const eqSample = parseLweSample(encEq);

  // Build public inputs: gt_a[500], gt_b, eq_a[500], eq_b, claimed_gt, claimed_eq, key_commitment
  const publicInputs = [];
  for (let i = 0; i < 500; i++) publicInputs.push(toHex32(gtSample.a[i]));
  publicInputs.push(toHex32(gtSample.b));
  for (let i = 0; i < 500; i++) publicInputs.push(toHex32(eqSample.a[i]));
  publicInputs.push(toHex32(eqSample.b));
  publicInputs.push(toHex32(compareResult.claimedGt ? 1 : 0));
  publicInputs.push(toHex32(compareResult.claimedEq ? 1 : 0));
  publicInputs.push(toHex32(BigInt(onChainKeyCommitment)));

  const proofBytes = hexToBytes(compareResult.proof);
  const t0Verify = performance.now();
  const proofValid = await decryptionBackend.verifyProof({ proof: proofBytes, publicInputs });
  const verifyElapsed = ((performance.now() - t0Verify) / 1000).toFixed(1);

  if (!proofValid) {
    console.error("  Decryption proof verification FAILED!");
    process.exit(1);
  }
  info(`Decryption proof verified in ${verifyElapsed}s`);

  // Cleanup
  await movementBackend.destroy();
  await entityBackend.destroy();
  await decryptionBackend.destroy();

  // Done
  console.log("\n" + "=".repeat(50));
  console.log("Integration test passed.");
  console.log(`  Registered, deposited, relayed ${path.length} moves, encountered + minted entity ${encounter.entityId}.`);
  console.log(`  Restarted server (chain recovery), moved after restart.`);
  console.log(`  Transferred NFT, recovered secrets, moved entity with ZK proof.`);
  console.log(`  FHE comparison verified against ground truth, decryption proof verified (ZK).`);
}

main().then(() => {
  process.exit(0); // bb.js WASM workers keep the event loop alive
}).catch((e) => {
  console.error("\nIntegration test failed:", e.message);
  process.exit(1);
});
