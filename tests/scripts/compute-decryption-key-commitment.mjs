#!/usr/bin/env node
/**
 * Compute Poseidon decryption key commitment from the FHE secret key.
 * Extracts 500 LWE key bits via WASM, packs into 2 Fields, hashes with Poseidon.
 * Outputs 0x-prefixed bytes32 hex string.
 *
 * Usage: node tests/scripts/compute-decryption-key-commitment.mjs [data_dir]
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const dataDir = process.argv[2] || resolve(__dirname, "../../app/data");
const distDir = resolve(__dirname, "../../fhe-wasm/dist");
const secretKeyPath = resolve(dataDir, "secret.key");

if (!existsSync(secretKeyPath) || !existsSync(resolve(distDir, "tfhe.js"))) {
  process.stdout.write("0x" + "0".repeat(64));
  process.exit(0);
}

// Load FHE WASM (from fhe-wasm/dist/ to avoid ESM scope issues)
const createTFHEModule = require(resolve(distDir, "tfhe.js"));
const fhe = await createTFHEModule({
  wasmBinary: readFileSync(resolve(distDir, "tfhe.wasm")),
});

// Load secret key
const skData = readFileSync(secretKeyPath);
const skPtr = fhe._tfhe_malloc(skData.length);
fhe.HEAPU8.set(skData, skPtr);
const rc = fhe.ccall("tfhe_load_secret_key", "number", ["number", "number"], [skPtr, skData.length]);
fhe._tfhe_free(skPtr);
if (rc !== 0) {
  process.stderr.write("Failed to load FHE secret key\n");
  process.stdout.write("0x" + "0".repeat(64));
  process.exit(0);
}

// Extract LWE key bits
const n = fhe.ccall("tfhe_get_lwe_dimension", "number", [], []);
if (n !== 500) {
  process.stderr.write(`Unexpected LWE dimension: ${n}\n`);
  process.stdout.write("0x" + "0".repeat(64));
  process.exit(0);
}

const keyBufSize = n * 4;
const keyBufPtr = fhe._tfhe_malloc(keyBufSize);
const rc2 = fhe.ccall("tfhe_export_lwe_key_bits", "number", ["number", "number"], [keyBufPtr, keyBufSize]);
if (rc2 !== 0) {
  fhe._tfhe_free(keyBufPtr);
  process.stderr.write("Failed to export LWE key bits\n");
  process.stdout.write("0x" + "0".repeat(64));
  process.exit(0);
}

const lweKeyBits = [];
for (let i = 0; i < n; i++) {
  lweKeyBits.push(fhe.HEAPU8[keyBufPtr + i * 4]); // LE u32, only bit 0 matters
}
fhe._tfhe_free(keyBufPtr);

// Pack into 2 Fields (250 bits each) and hash with Poseidon
let packedLo = 0n;
let packedHi = 0n;
for (let i = 0; i < 250; i++) {
  if (lweKeyBits[i]) packedLo |= 1n << BigInt(i);
}
for (let i = 0; i < 250; i++) {
  if (lweKeyBits[250 + i]) packedHi |= 1n << BigInt(i);
}

const { buildPoseidon } = await import("circomlibjs");
const poseidon = await buildPoseidon();
const commitment = poseidon.F.toObject(poseidon([packedLo, packedHi]));
process.stdout.write("0x" + commitment.toString(16).padStart(64, "0"));

fhe.ccall("tfhe_cleanup", "void", [], []);
