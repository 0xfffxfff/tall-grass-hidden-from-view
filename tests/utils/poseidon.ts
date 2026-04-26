import { buildPoseidon, type Poseidon } from "circomlibjs";

let poseidonInstance: Poseidon | null = null;

async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Poseidon hash matching Noir's poseidon::bn254::hash_N.
 *
 * circomlibjs returns an ArrayBuffer (F1 element). We convert to bigint
 * for direct comparison with Noir field values.
 */
export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs);
  // poseidon.F.toObject converts the internal representation to a bigint
  return poseidon.F.toObject(hash) as bigint;
}
