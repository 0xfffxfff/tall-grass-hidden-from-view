import {
  poseidon1,
  poseidon2,
  poseidon3,
  poseidon4,
  poseidon5,
  poseidon6,
  poseidon7,
  poseidon8,
} from "poseidon-lite";

export type PoseidonHasher = { __ready: true };

const HASHERS: Record<number, (inputs: bigint[]) => bigint> = {
  1: poseidon1 as (i: bigint[]) => bigint,
  2: poseidon2 as (i: bigint[]) => bigint,
  3: poseidon3 as (i: bigint[]) => bigint,
  4: poseidon4 as (i: bigint[]) => bigint,
  5: poseidon5 as (i: bigint[]) => bigint,
  6: poseidon6 as (i: bigint[]) => bigint,
  7: poseidon7 as (i: bigint[]) => bigint,
  8: poseidon8 as (i: bigint[]) => bigint,
};

const SENTINEL: PoseidonHasher = { __ready: true };

export function usePoseidon(): PoseidonHasher {
  return SENTINEL;
}

export function poseidonHash(_p: PoseidonHasher, inputs: bigint[]): bigint {
  const fn = HASHERS[inputs.length];
  if (!fn) throw new Error(`poseidonHash: unsupported arity ${inputs.length}`);
  return fn(inputs);
}
