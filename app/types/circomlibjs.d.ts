declare module "circomlibjs" {
  interface PoseidonField {
    toObject(el: unknown): bigint;
  }

  interface PoseidonHasher {
    (inputs: bigint[]): unknown;
    F: PoseidonField;
  }

  export function buildPoseidon(): Promise<PoseidonHasher>;
}
