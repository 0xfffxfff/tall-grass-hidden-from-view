import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { createNoir, createBackend } from "./utils/circuit.js";
import { commitPosition, DIRECTION } from "./utils/commitment.js";

describe("movement proof", () => {
  let noir: Noir;
  let backend: UltraHonkBackend;

  beforeAll(async () => {
    noir = await createNoir();
    backend = await createBackend();
  });

  afterAll(async () => {
    await backend.destroy();
  });

  async function makeInputs(
    oldX: bigint,
    oldY: bigint,
    oldSalt: bigint,
    newX: bigint,
    newY: bigint,
    newSalt: bigint,
    direction: number,
    gridWidth: bigint,
    gridHeight: bigint,
  ) {
    const oldCommitment = await commitPosition(oldX, oldY, oldSalt);
    const newCommitment = await commitPosition(newX, newY, newSalt);
    return {
      old_x: oldX.toString(),
      old_y: oldY.toString(),
      old_salt: oldSalt.toString(),
      new_x: newX.toString(),
      new_y: newY.toString(),
      new_salt: newSalt.toString(),
      direction: direction.toString(),
      old_commitment: "0x" + oldCommitment.toString(16),
      new_commitment: "0x" + newCommitment.toString(16),
      grid_width: gridWidth.toString(),
      grid_height: gridHeight.toString(),
    };
  }

  it("generate and verify proof for valid move", async () => {
    const inputs = await makeInputs(5n, 5n, 111n, 5n, 6n, 222n, DIRECTION.NORTH, 32n, 32n);

    const { witness } = await noir.execute(inputs);
    const proof = await backend.generateProof(witness);
    const valid = await backend.verifyProof(proof);

    expect(valid).toBe(true);
  });

  it("proof verifies for toroidal wrap", async () => {
    // East wrap: x=31 -> x=0 on 32x32
    const inputs = await makeInputs(31n, 10n, 333n, 0n, 10n, 444n, DIRECTION.EAST, 32n, 32n);

    const { witness } = await noir.execute(inputs);
    const proof = await backend.generateProof(witness);
    const valid = await backend.verifyProof(proof);

    expect(valid).toBe(true);
  });

  it("witness generation fails for invalid move", async () => {
    // Try to move 2 cells east
    const inputs = await makeInputs(5n, 5n, 111n, 7n, 5n, 222n, DIRECTION.EAST, 32n, 32n);

    await expect(noir.execute(inputs)).rejects.toThrow();
  });

  it("proof generation timing", async () => {
    const inputs = await makeInputs(10n, 10n, 555n, 10n, 11n, 666n, DIRECTION.NORTH, 32n, 32n);

    const { witness } = await noir.execute(inputs);

    const start = performance.now();
    const proof = await backend.generateProof(witness);
    const proveMs = performance.now() - start;

    const vStart = performance.now();
    const valid = await backend.verifyProof(proof);
    const verifyMs = performance.now() - vStart;

    expect(valid).toBe(true);
    console.log(`  Prove: ${(proveMs / 1000).toFixed(1)}s | Verify: ${(verifyMs / 1000).toFixed(1)}s`);
  });
});
