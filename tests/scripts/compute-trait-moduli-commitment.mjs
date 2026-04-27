#!/usr/bin/env node
/**
 * Compute keccak256 commitment over the trait moduli for contract deployment.
 *
 * Reads TRAIT_MODULI from env (e.g. "N1,N2,..."). Each value is
 * encoded as a uint16 big-endian; the concatenation is keccak256-hashed.
 *
 * Outputs 0x-prefixed bytes32 hex string.
 *
 * Usage: TRAIT_MODULI=N1,N2,... node tests/scripts/compute-trait-moduli-commitment.mjs
 */

import pkg from "ethers";
const keccak256 = pkg.utils?.keccak256 ?? pkg.keccak256;

const env = process.env.TRAIT_MODULI;
if (!env) {
  process.stderr.write('TRAIT_MODULI env var required (e.g. "N1,N2,...").\n');
  process.exit(1);
}

const moduli = env.split(",").map((s) => parseInt(s.trim(), 10));
if (moduli.some((n) => !Number.isInteger(n) || n < 1 || n > 65535)) {
  process.stderr.write("TRAIT_MODULI must be comma-separated positive integers in [1, 65535].\n");
  process.exit(1);
}

// Pack as uint16 big-endian (matches Solidity abi.encodePacked(uint16[]))
const buf = Buffer.alloc(moduli.length * 2);
for (let i = 0; i < moduli.length; i++) {
  buf.writeUInt16BE(moduli[i], i * 2);
}

process.stdout.write(keccak256(buf));
