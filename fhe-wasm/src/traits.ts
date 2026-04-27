// Deterministic trait generation from seed.
//
// Each trait value: SHA-256(seed || entity_index_le32 || trait_index_le32)[0]
// reduced modulo TRAIT_MODULI[trait_index]. Matches the C++ implementation
// in keygen.cpp byte-exact.
//
// Moduli are loaded at runtime from the TRAIT_MODULI env var
// (e.g. "N1,N2,..."). Kept out of source so the schema stays
// private; commitment is bound on-chain via traitModuliCommitment.

import { createHash } from "crypto";

let cachedModuli: number[] | null = null;
function getTraitModuli(): number[] {
  if (cachedModuli) return cachedModuli;
  const env = process.env.TRAIT_MODULI;
  if (!env) {
    throw new Error('TRAIT_MODULI env var required (e.g. "N1,N2,...")');
  }
  const parts = env.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 65535)) {
    throw new Error("TRAIT_MODULI must be comma-separated positive integers");
  }
  cachedModuli = parts;
  return parts;
}

/** Write a uint32 as 4 little-endian bytes into buf at offset. */
function writeU32LE(buf: Buffer, value: number, offset: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Derive a single trait value, reduced to the trait's range.
 * @param seed - Seed bytes (Buffer or Uint8Array)
 * @param entityIndex - Entity index (u32)
 * @param traitIndex - Trait index (u32, 0..6)
 * @returns Trait value in [0, TRAIT_MODULI[traitIndex]).
 */
export function deriveTrait(
  seed: Buffer | Uint8Array,
  entityIndex: number,
  traitIndex: number
): number {
  const msg = Buffer.alloc(seed.length + 8);
  Buffer.from(seed).copy(msg, 0);
  writeU32LE(msg, entityIndex, seed.length);
  writeU32LE(msg, traitIndex, seed.length + 4);
  const hash = createHash("sha256").update(msg).digest();
  const moduli = getTraitModuli();
  const mod = traitIndex < moduli.length ? moduli[traitIndex] : 256;
  return hash[0] % mod;
}

/**
 * Derive all trait values for a single entity.
 * @param seed - Seed bytes
 * @param entityIndex - Entity index (u32)
 * @param traitCount - Number of traits
 * @returns Array of trait values (0-255)
 */
export function deriveEntityTraits(
  seed: Buffer | Uint8Array,
  entityIndex: number,
  traitCount: number
): number[] {
  const traits: number[] = [];
  for (let t = 0; t < traitCount; t++) {
    traits.push(deriveTrait(seed, entityIndex, t));
  }
  return traits;
}

/**
 * Derive traits for all entities.
 * @param seed - Seed bytes
 * @param entityCount - Number of entities
 * @param traitCount - Number of traits per entity
 * @returns Array of arrays of trait values
 */
export function deriveAllTraits(
  seed: Buffer | Uint8Array,
  entityCount: number,
  traitCount: number
): number[][] {
  const all: number[][] = [];
  for (let e = 0; e < entityCount; e++) {
    all.push(deriveEntityTraits(seed, e, traitCount));
  }
  return all;
}
