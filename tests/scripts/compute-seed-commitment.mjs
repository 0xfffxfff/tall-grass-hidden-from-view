#!/usr/bin/env node
/**
 * Compute Poseidon seed commitment from manifest.json for contract deployment.
 * Outputs 0x-prefixed bytes32 hex string.
 *
 * Usage: node tests/scripts/compute-seed-commitment.mjs [manifest_path]
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = process.argv[2] || resolve(__dirname, "../../app/data/manifest.json");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
} catch {
  // No manifest — output zero
  process.stdout.write("0x" + "0".repeat(64));
  process.exit(0);
}

const { buildPoseidon } = await import("circomlibjs");
const poseidon = await buildPoseidon();
const seed = BigInt("0x" + manifest.seed);
const commitment = poseidon.F.toObject(poseidon([seed]));
process.stdout.write("0x" + commitment.toString(16).padStart(64, "0"));
