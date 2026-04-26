import { describe, it, expect } from "vitest";
import { poseidonHash } from "./utils/poseidon.js";
import { commitPosition } from "./utils/commitment.js";

/**
 * Poseidon compatibility: JS (circomlibjs) must produce the same output
 * as Noir (poseidon::bn254::hash_N from noir-lang/poseidon v0.2.3).
 *
 * Both use the same x^5 Poseidon with BN254 field constants from
 * https://extgit.iaik.tugraz.at/krypto/hadeshash
 *
 * Test vectors are taken from the poseidon library's own test suite
 * (src/tests.nr at v0.2.3). If these fail, circomlibjs and the Noir
 * poseidon library are using different parameters — see SPEC for
 * fallback strategy (use noir_js execute() as a hash oracle).
 */
describe("poseidon compatibility", () => {
  it("hash_2([1, 2]) matches Noir test vector", async () => {
    const result = await poseidonHash([1n, 2n]);
    const expected = BigInt(
      "0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a",
    );
    expect(result).toBe(expected);
  });

  it("hash_4([1, 2, 3, 4]) matches Noir test vector", async () => {
    const result = await poseidonHash([1n, 2n, 3n, 4n]);
    const expected = BigInt(
      "0x299c867db6c1fdd79dcefa40e4510b9837e60ebb1ce0663dbaa525df65250465",
    );
    expect(result).toBe(expected);
  });

  it("hash_1([42]) matches Noir test vector", async () => {
    const result = await poseidonHash([42n]);
    const expected = BigInt(
      "0x1b408dafebeddf0871388399b1e53bd065fd70f18580be5cdde15d7eb2c52743",
    );
    expect(result).toBe(expected);
  });

  it("hash_3 (position commitment) is deterministic", async () => {
    const a = await commitPosition(5n, 10n, 999n);
    const b = await commitPosition(5n, 10n, 999n);
    expect(a).toBe(b);
  });

  it("hash_3 (position commitment) changes with salt", async () => {
    const a = await commitPosition(5n, 10n, 111n);
    const b = await commitPosition(5n, 10n, 222n);
    expect(a).not.toBe(b);
  });
});
