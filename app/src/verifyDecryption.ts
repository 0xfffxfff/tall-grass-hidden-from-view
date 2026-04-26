// Browser-side ZK verification of FHE decryption proofs.
//
// Verifies that the oracle correctly decrypted TFHE comparison results
// under a committed secret key, using bb.js UltraHonk verification.

import { UltraHonkBackend } from "@aztec/bb.js";

let backend: UltraHonkBackend | null = null;
let keyCommitment: string | null = null;

// LWE dimension for lambda=80 TFHE parameters
const LWE_N = 500;
// Serialized LweSample size: 4 (UID) + 500*4 (a) + 4 (b) + 8 (variance) = 2016
const LWE_SAMPLE_SIZE = 2016;

// Parse a serialized TFHE LweSample (2016 bytes) into mask vector a[500] and body b.
export function parseLweSample(data: Uint8Array): { a: number[]; b: number } {
  if (data.length !== LWE_SAMPLE_SIZE) {
    throw new Error(`Expected ${LWE_SAMPLE_SIZE} bytes, got ${data.length}`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const a: number[] = [];
  let offset = 4; // skip UID
  for (let i = 0; i < LWE_N; i++) {
    a.push(view.getUint32(offset, true));
    offset += 4;
  }
  const b = view.getUint32(offset, true);
  return { a, b };
}

// Initialize the verification backend (load circuit, cache).
// Call once at startup or lazily on first verification.
export async function initVerifier(): Promise<void> {
  if (backend) return;

  const res = await fetch("/data/decryption.json");
  if (!res.ok) throw new Error("Failed to load decryption circuit");
  const circuit = await res.json();
  backend = new UltraHonkBackend(circuit.bytecode);
}

// Set the decryption key commitment (read from contract or /api/contract).
export function setKeyCommitment(commitment: string): void {
  keyCommitment = commitment;
}

// Verify a decryption proof.
// Returns true if the proof is valid, false otherwise.
export async function verifyComparisonProof(
  gtSampleBytes: Uint8Array,
  eqSampleBytes: Uint8Array,
  claimedGt: boolean,
  claimedEq: boolean,
  proofHex: string,
): Promise<boolean> {
  if (!backend) {
    await initVerifier();
  }
  if (!backend || !keyCommitment) {
    throw new Error("Verifier not initialized or key commitment not set");
  }

  const gtSample = parseLweSample(gtSampleBytes);
  const eqSample = parseLweSample(eqSampleBytes);

  // Build public inputs array matching circuit parameter order:
  // s[500] (private, not included), then:
  // gt_a[500], gt_b, eq_a[500], eq_b, claimed_gt, claimed_eq, key_commitment
  const publicInputs: string[] = [];

  // gt_a[500]
  for (let i = 0; i < LWE_N; i++) {
    publicInputs.push(toHex32(BigInt(gtSample.a[i])));
  }
  // gt_b
  publicInputs.push(toHex32(BigInt(gtSample.b)));

  // eq_a[500]
  for (let i = 0; i < LWE_N; i++) {
    publicInputs.push(toHex32(BigInt(eqSample.a[i])));
  }
  // eq_b
  publicInputs.push(toHex32(BigInt(eqSample.b)));

  // claimed_gt, claimed_eq (booleans as 0/1)
  publicInputs.push(toHex32(claimedGt ? 1n : 0n));
  publicInputs.push(toHex32(claimedEq ? 1n : 0n));

  // key_commitment (Field element)
  publicInputs.push(keyCommitment);

  const proofBytes = hexToBytes(proofHex);

  try {
    const verified = await backend.verifyProof({
      proof: proofBytes,
      publicInputs,
    });
    return verified;
  } catch {
    return false;
  }
}

function toHex32(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.slice(i, i + 2), 16);
  }
  return bytes;
}
