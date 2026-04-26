// Entity trait Merkle tree generator.
//
// Reads a batch manifest, computes keccak256 of each entity ciphertext file,
// and builds a StandardMerkleTree compatible with solady's MerkleProofLib.
//
// The contract verifies:
//   bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(entityId, _entityTraitHash))));
//   MerkleProofLib.verifyCalldata(proof, root, leaf)
//
// StandardMerkleTree.of() produces this exact double-hash structure.
//
// Usage: npx tsx src/merkle.ts <batch_dir>

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { keccak256 } from "ethereum-cryptography/keccak";
import { bytesToHex } from "ethereum-cryptography/utils";

interface ManifestEntity {
  id: number;
  traits: number[];
  sha256: string;
  file: string;
  size: number;
}

interface Manifest {
  seed: string;
  entityCount: number;
  traitCount: number;
  entities: ManifestEntity[];
}

function keccak256Hex(data: Uint8Array): string {
  return "0x" + bytesToHex(keccak256(data));
}

export function buildMerkleTree(batchDir: string) {
  const manifestPath = join(batchDir, "manifest.json");
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  // Build tree values: [entityId, ciphertextHash]
  const values: [bigint, string][] = [];
  const entityData: Array<{
    id: number;
    ciphertextHash: string;
  }> = [];

  for (const entity of manifest.entities) {
    const filePath = join(batchDir, entity.file);
    const data = readFileSync(filePath);
    const hash = keccak256Hex(data);

    values.push([BigInt(entity.id), hash]);
    entityData.push({ id: entity.id, ciphertextHash: hash });
  }

  // Build StandardMerkleTree — produces sorted-pair double-hash tree
  // compatible with solady MerkleProofLib
  const tree = StandardMerkleTree.of(values, ["uint256", "bytes32"]);

  // Generate per-entity proofs
  const entities = entityData.map((e) => {
    for (const [i, v] of tree.entries()) {
      if (Number(v[0]) === e.id) {
        return {
          id: e.id,
          ciphertextHash: e.ciphertextHash,
          proof: tree.getProof(i),
        };
      }
    }
    throw new Error(`Entity ${e.id} not found in tree`);
  });

  return {
    root: tree.root,
    entities,
    tree,
  };
}

// CLI entry point
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("merkle.ts") ||
    process.argv[1].endsWith("merkle.js"))
) {
  const batchDir = process.argv[2];
  if (!batchDir) {
    console.error("Usage: npx tsx src/merkle.ts <batch_dir>");
    process.exit(1);
  }

  const result = buildMerkleTree(batchDir);

  const output = {
    root: result.root,
    entities: result.entities,
  };

  const outputPath = join(batchDir, "merkle.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Root: ${result.root}`);
  console.log(`Wrote ${output.entities.length} entity proofs to ${outputPath}`);
}
