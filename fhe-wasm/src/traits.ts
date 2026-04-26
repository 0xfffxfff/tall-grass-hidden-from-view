// Deterministic trait generation from seed.
//
// Each trait value is derived: SHA-256(seed || entity_index_le32 || trait_index_le32)[0].
// Matches the C++ implementation in keygen.cpp and the Rust implementation in fhe/src/traits.rs.

import { createHash } from "crypto";

/** Write a uint32 as 4 little-endian bytes into buf at offset. */
function writeU32LE(buf: Buffer, value: number, offset: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Derive a single trait value.
 * @param seed - Seed bytes (Buffer or Uint8Array)
 * @param entityIndex - Entity index (u32)
 * @param traitIndex - Trait index (u32)
 * @returns Trait value (0-255)
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
  return hash[0];
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
