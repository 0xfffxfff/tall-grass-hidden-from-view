import { poseidonHash } from "./poseidon.js";

/// Direction encoding (must match circuits/lib/src/grid.nr):
///   0 = North (y + 1)
///   1 = South (y - 1)
///   2 = East  (x + 1)
///   3 = West  (x - 1)
export const DIRECTION = {
  NORTH: 0,
  SOUTH: 1,
  EAST: 2,
  WEST: 3,
} as const;

/**
 * Position commitment: Poseidon(x, y, salt)
 * Matches lib::commitment::commit_position in Noir.
 */
export async function commitPosition(
  x: bigint,
  y: bigint,
  salt: bigint,
): Promise<bigint> {
  return poseidonHash([x, y, salt]);
}
