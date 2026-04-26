/**
 * Optional batch pre-computation of FHE comparison decryption proofs.
 *
 * Pre-populates the proof cache (app/data/comparison-proofs/) for all
 * entity pair + trait combinations. Can be interrupted and resumed —
 * existing cache entries are skipped.
 *
 * Usage:
 *   node tests/scripts/precompute-comparisons.mjs [data_dir]
 *
 * Default data_dir: app/data
 *
 * Requires:
 *   - app/data/secret.key       (TFHE secret key)
 *   - app/data/cloud.key        (TFHE cloud key)
 *   - app/data/entities/*.bin   (entity ciphertexts)
 *   - app/data/manifest.json    (batch manifest)
 *   - fhe-wasm/dist/tfhe.{js,wasm}
 *   - circuits/target/decryption.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DATA_DIR = resolve(process.argv[2] || join(__dirname, "../../app/data"));
const FHE_DIST = resolve(join(__dirname, "../../fhe-wasm/dist"));
const CIRCUIT_PATH = resolve(join(__dirname, "../../circuits/target/decryption.json"));
const PROOFS_DIR = join(DATA_DIR, "comparison-proofs");

function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Parse serialized LweSample: 4 UID + 500 x u32 LE + 1 x u32 LE + 8 variance
function parseLweSample(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const a = [];
  let offset = 4;
  for (let i = 0; i < 500; i++) {
    a.push(view.getUint32(offset, true));
    offset += 4;
  }
  const b = view.getUint32(offset, true);
  return { a, b };
}

async function main() {
  console.log("Batch pre-computation of FHE comparison decryption proofs\n");

  // 1. Load manifest
  const manifestPath = join(DATA_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error("manifest.json not found at", manifestPath);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const entityCount = manifest.entityCount;
  const traitCount = manifest.traitCount || 7;
  console.log(`Entities: ${entityCount}, Traits: ${traitCount}`);

  const totalComparisons = (entityCount * (entityCount - 1)) / 2 * traitCount;
  console.log(`Total comparisons: ${totalComparisons}\n`);

  // 2. Load TFHE WASM + keys
  console.log("Loading TFHE WASM module...");
  const createTFHEModule = require(join(FHE_DIST, "tfhe.js"));
  const fhe = await createTFHEModule({
    wasmBinary: readFileSync(join(FHE_DIST, "tfhe.wasm")),
  });

  // Load secret key
  const skData = readFileSync(join(DATA_DIR, "secret.key"));
  const skPtr = fhe._tfhe_malloc(skData.length);
  fhe.HEAPU8.set(skData, skPtr);
  if (fhe.ccall("tfhe_load_secret_key", "number", ["number", "number"], [skPtr, skData.length]) !== 0) {
    throw new Error("Failed to load secret key");
  }
  fhe._tfhe_free(skPtr);
  console.log("  Secret key loaded.\n");

  // 3. Extract LWE key bits
  const n = fhe.ccall("tfhe_get_lwe_dimension", "number", [], []);
  if (n !== 500) throw new Error(`Unexpected LWE dimension: ${n}`);

  const keyBufSize = n * 4;
  const keyBufPtr = fhe._tfhe_malloc(keyBufSize);
  if (fhe.ccall("tfhe_export_lwe_key_bits", "number", ["number", "number"], [keyBufPtr, keyBufSize]) !== 0) {
    throw new Error("Failed to export LWE key bits");
  }
  const lweKeyBits = [];
  for (let i = 0; i < n; i++) {
    lweKeyBits.push(fhe.HEAPU8[keyBufPtr + i * 4]);
  }
  fhe._tfhe_free(keyBufPtr);
  console.log(`  LWE key extracted (${n} bits).`);

  // 4. Compute key commitment
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();

  let packedLo = 0n;
  let packedHi = 0n;
  for (let i = 0; i < 250; i++) {
    if (lweKeyBits[i]) packedLo |= 1n << BigInt(i);
  }
  for (let i = 0; i < 250; i++) {
    if (lweKeyBits[250 + i]) packedHi |= 1n << BigInt(i);
  }
  const kcHash = poseidon([packedLo, packedHi]);
  const keyCommitment = poseidon.F.toObject(kcHash);
  const keyCommitmentHex = "0x" + keyCommitment.toString(16).padStart(64, "0");
  console.log(`  Key commitment: ${keyCommitmentHex.slice(0, 18)}...\n`);

  // 5. Load decryption circuit
  console.log("Loading decryption circuit...");
  const { Noir } = await import("@noir-lang/noir_js");
  const { UltraHonkBackend } = await import("@aztec/bb.js");
  const circuit = JSON.parse(readFileSync(CIRCUIT_PATH, "utf-8"));
  const noir = new Noir(circuit);
  const backend = new UltraHonkBackend(circuit.bytecode);
  console.log("  Circuit + backend ready.\n");

  // 6. Load entity ciphertexts
  console.log("Loading entity ciphertexts...");
  const entitiesDir = join(DATA_DIR, "entities");
  const sampleSize = fhe.ccall("tfhe_ciphertext_size", "number", [], []);
  const ct8Size = sampleSize * 8;

  const entityTraits = new Map();
  for (let eid = 0; eid < entityCount; eid++) {
    const binPath = join(entitiesDir, `${eid}.bin`);
    if (!existsSync(binPath)) {
      console.warn(`  Entity ${eid} ciphertext not found, skipping.`);
      continue;
    }
    const data = readFileSync(binPath);
    const traits = [];
    for (let t = 0; t < traitCount; t++) {
      traits.push(data.slice(t * ct8Size, (t + 1) * ct8Size));
    }
    entityTraits.set(eid, traits);
  }
  console.log(`  Loaded ${entityTraits.size} entities.\n`);

  // 7. Create proofs directory
  mkdirSync(PROOFS_DIR, { recursive: true });

  // Count existing
  let existing = 0;
  let generated = 0;
  let failed = 0;
  const startTime = performance.now();

  // 8. Iterate all pairs
  for (let a = 0; a < entityCount; a++) {
    for (let b = a + 1; b < entityCount; b++) {
      const traitsA = entityTraits.get(a);
      const traitsB = entityTraits.get(b);
      if (!traitsA || !traitsB) continue;

      for (let t = 0; t < traitCount; t++) {
        const cacheFile = join(PROOFS_DIR, `${a}_${b}_${t}.json`);
        if (existsSync(cacheFile)) {
          existing++;
          continue;
        }

        const total = existing + generated + failed;
        const pct = ((total / totalComparisons) * 100).toFixed(1);
        process.stdout.write(`\r  [${pct}%] ${a}v${b} trait ${t} (${generated} new, ${existing} cached, ${failed} failed)`);

        try {
          // Run FHE comparison
          const traitA = traitsA[t];
          const traitB = traitsB[t];

          // GT
          const aPtr = fhe._tfhe_malloc(traitA.length);
          fhe.HEAPU8.set(traitA, aPtr);
          const bPtr = fhe._tfhe_malloc(traitB.length);
          fhe.HEAPU8.set(traitB, bPtr);
          const gtLenPtr = fhe._tfhe_malloc(4);
          const gtDataPtr = fhe.ccall(
            "tfhe_compare_gt", "number",
            ["number", "number", "number", "number", "number"],
            [aPtr, traitA.length, bPtr, traitB.length, gtLenPtr],
          );
          const gtLen = fhe.getValue(gtLenPtr, "i32");
          fhe._tfhe_free(aPtr); fhe._tfhe_free(bPtr); fhe._tfhe_free(gtLenPtr);
          const gtBytes = new Uint8Array(fhe.HEAPU8.buffer, gtDataPtr, gtLen).slice();
          fhe._tfhe_free(gtDataPtr);

          // EQ
          const aPtr2 = fhe._tfhe_malloc(traitA.length);
          fhe.HEAPU8.set(traitA, aPtr2);
          const bPtr2 = fhe._tfhe_malloc(traitB.length);
          fhe.HEAPU8.set(traitB, bPtr2);
          const eqLenPtr = fhe._tfhe_malloc(4);
          const eqDataPtr = fhe.ccall(
            "tfhe_compare_eq", "number",
            ["number", "number", "number", "number", "number"],
            [aPtr2, traitA.length, bPtr2, traitB.length, eqLenPtr],
          );
          const eqLen = fhe.getValue(eqLenPtr, "i32");
          fhe._tfhe_free(aPtr2); fhe._tfhe_free(bPtr2); fhe._tfhe_free(eqLenPtr);
          const eqBytes = new Uint8Array(fhe.HEAPU8.buffer, eqDataPtr, eqLen).slice();
          fhe._tfhe_free(eqDataPtr);

          // Decrypt
          const gtCtPtr = fhe._tfhe_malloc(gtBytes.length);
          fhe.HEAPU8.set(gtBytes, gtCtPtr);
          const gtBit = fhe.ccall("tfhe_decrypt_bit", "number", ["number", "number"], [gtCtPtr, gtBytes.length]);
          fhe._tfhe_free(gtCtPtr);

          const eqCtPtr = fhe._tfhe_malloc(eqBytes.length);
          fhe.HEAPU8.set(eqBytes, eqCtPtr);
          const eqBit = fhe.ccall("tfhe_decrypt_bit", "number", ["number", "number"], [eqCtPtr, eqBytes.length]);
          fhe._tfhe_free(eqCtPtr);

          const claimedGt = gtBit === 1;
          const claimedEq = eqBit === 1;
          let result;
          if (claimedEq) result = "=";
          else if (claimedGt) result = ">";
          else result = "<";

          // Parse samples for circuit
          const gtSample = parseLweSample(gtBytes);
          const eqSample = parseLweSample(eqBytes);

          // Build circuit inputs
          const inputs = {};
          for (let i = 0; i < 500; i++) inputs[`s[${i}]`] = String(lweKeyBits[i]);
          for (let i = 0; i < 500; i++) inputs[`gt_a[${i}]`] = String(gtSample.a[i]);
          inputs["gt_b"] = String(gtSample.b);
          for (let i = 0; i < 500; i++) inputs[`eq_a[${i}]`] = String(eqSample.a[i]);
          inputs["eq_b"] = String(eqSample.b);
          inputs["claimed_gt"] = claimedGt ? "true" : "false";
          inputs["claimed_eq"] = claimedEq ? "true" : "false";
          inputs["key_commitment"] = String(keyCommitment);

          // Generate proof
          const { witness } = await noir.execute(inputs);
          const proofResult = await backend.generateProof(witness, { keccak: false });
          const proofHex = bytesToHex(proofResult.proof);

          // Write cache entry
          const entry = {
            entityA: a,
            entityB: b,
            traitIndex: t,
            result,
            claimedGt,
            claimedEq,
            proof: proofHex,
          };
          writeFileSync(cacheFile, JSON.stringify(entry, null, 2));
          generated++;
        } catch (e) {
          failed++;
          console.error(`\n  ERROR: ${a}v${b} trait ${t}: ${e.message}`);
        }
      }
    }
  }

  const elapsed = ((performance.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n\nDone. ${generated} new proofs generated, ${existing} cached, ${failed} failed. (${elapsed} min)`);

  // Write manifest
  const manifestOut = {
    decryptionKeyCommitment: keyCommitmentHex,
    entityCount,
    traitCount,
    totalProofs: existing + generated,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(PROOFS_DIR, "manifest.json"), JSON.stringify(manifestOut, null, 2));
  console.log(`Manifest written to ${join(PROOFS_DIR, "manifest.json")}`);

  await backend.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
