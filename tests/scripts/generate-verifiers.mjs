/**
 * Generate Solidity verifier contracts from compiled Noir circuits.
 *
 * Produces four files:
 *   - HonkBase.sol   — shared types, libraries, and abstract BaseHonkVerifier
 *   - MovementVerifier.sol — VK + thin contract
 *   - EntityMovementVerifier.sol — VK + thin contract
 *   - EncounterVerifier.sol — VK + thin contract
 *
 * Heavy library functions (RelationsLib, TranscriptLib) are made `public` so
 * they deploy as separate contracts linked via DELEGATECALL, keeping each
 * verifier well under the 24KB Spurious Dragon limit.
 *
 * Usage: node tests/scripts/generate-verifiers.mjs
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { UltraHonkBackend } from "@aztec/bb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = resolve(__dirname, "../../circuits/target");
const OUTPUT_DIR = resolve(__dirname, "../../contracts/src");

const CIRCUITS = [
  { name: "movement", contractName: "MovementVerifier" },
  { name: "entity_movement", contractName: "EntityMovementVerifier" },
  { name: "encounter", contractName: "EncounterVerifier" },
  { name: "decryption", contractName: "DecryptionVerifier" },
];

/**
 * Split a bb.js-generated verifier into:
 *   header  — everything before the second `pragma` (constants + VK library)
 *   base    — from second `pragma` through end of BaseHonkVerifier (shared code)
 *   tail    — the concrete `contract ... is BaseHonkVerifier(...)` block
 */
function splitVerifier(solidity) {
  const lines = solidity.split("\n");

  // Find the second `pragma` — that's where shared code starts
  let pragmaCount = 0;
  let splitIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("pragma solidity")) {
      pragmaCount++;
      if (pragmaCount === 2) {
        splitIdx = i;
        break;
      }
    }
  }
  if (splitIdx === -1) throw new Error("Could not find second pragma");

  // Find `contract ... is BaseHonkVerifier` — that's where the tail starts
  let tailIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].match(/^contract \w+ is BaseHonkVerifier/)) {
      tailIdx = i;
      break;
    }
  }
  if (tailIdx === -1) throw new Error("Could not find concrete contract");

  // header: lines 0..splitIdx-1 (skip trailing blank lines)
  let headerEnd = splitIdx - 1;
  while (headerEnd > 0 && lines[headerEnd].trim() === "") headerEnd--;
  const header = lines.slice(0, headerEnd + 1).join("\n");

  // base: lines splitIdx..tailIdx-1
  let baseEnd = tailIdx - 1;
  while (baseEnd > splitIdx && lines[baseEnd].trim() === "") baseEnd--;
  const base = lines.slice(splitIdx, baseEnd + 1).join("\n");

  // tail: lines tailIdx..end
  const tail = lines.slice(tailIdx).join("\n");

  return { header, base, tail };
}

/**
 * Make library functions `public` instead of `internal` for named libraries.
 * Public library functions are called via DELEGATECALL to the deployed library,
 * keeping the calling contract's bytecode small.
 */
function makeLibraryFunctionsPublic(code, libraryNames) {
  const lines = code.split("\n");
  const result = [];
  let insideTargetLibrary = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we're entering a target library
    const libMatch = line.match(/^library (\w+)/);
    if (libMatch && libraryNames.includes(libMatch[1])) {
      insideTargetLibrary = true;
      braceDepth = 0;
    }

    // Track brace depth while inside a target library
    if (insideTargetLibrary) {
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (braceDepth === 0 && line.includes("}")) {
        insideTargetLibrary = false;
      }
    }

    // Replace internal -> public for function signatures inside target libraries
    if (insideTargetLibrary && line.match(/\)\s+internal\s+/)) {
      result.push(line.replace(/\binternal\b/, "public"));
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let baseCode = null;

  for (const { name, contractName } of CIRCUITS) {
    console.log(`Loading ${name} circuit...`);
    const raw = await readFile(resolve(CIRCUITS_DIR, `${name}.json`), "utf-8");
    const circuit = JSON.parse(raw);

    console.log(`Creating backend for ${name}...`);
    const backend = new UltraHonkBackend(circuit.bytecode);

    console.log(`Generating Solidity verifier for ${name}...`);
    let solidity = await backend.getSolidityVerifier();

    // Rename HonkVerifier -> contractName
    solidity = solidity.replace(/contract HonkVerifier/g, `contract ${contractName}`);
    // Mark assembly blocks memory-safe
    solidity = solidity.replace(/assembly\s*\{/g, 'assembly ("memory-safe") {');
    // Rename HonkVerificationKey to circuit-specific name to avoid collision
    const vkLibName = `${contractName}VK`;
    solidity = solidity.replace(/HonkVerificationKey/g, vkLibName);

    const { header, base, tail } = splitVerifier(solidity);

    // Extract base once (identical across all circuits)
    if (!baseCode) {
      baseCode = base;

      // Make heavy library functions public for external linking (DELEGATECALL).
      // This keeps verifier contract bytecode under the 24KB limit.
      baseCode = makeLibraryFunctionsPublic(baseCode, [
        "RelationsLib",
        "TranscriptLib",
        "CommitmentSchemeLib",
      ]);

      const baseFile = [
        "// SPDX-License-Identifier: Apache-2.0",
        "// Copyright 2022 Aztec",
        "// Shared Honk verification logic — extracted by generate-verifiers.mjs",
        "// Heavy library functions are public (DELEGATECALL) to stay under 24KB.",
        "",
        baseCode,
        "",
      ].join("\n");
      const basePath = resolve(OUTPUT_DIR, "HonkBase.sol");
      await writeFile(basePath, baseFile, "utf-8");
      console.log(`Wrote ${basePath}`);
    }

    // Write thin verifier: header (constants + VK) + import + tail
    const verifierFile = [
      "// SPDX-License-Identifier: Apache-2.0",
      "// Copyright 2022 Aztec",
      header.split("\n").slice(2).join("\n"), // skip duplicate SPDX+copyright
      "",
      'import {Honk, BaseHonkVerifier} from "./HonkBase.sol";',
      "",
      tail,
      "",
    ].join("\n");
    const outPath = resolve(OUTPUT_DIR, `${contractName}.sol`);
    await writeFile(outPath, verifierFile, "utf-8");
    console.log(`Wrote ${outPath}`);

    await backend.destroy();
  }

  console.log("\nDone. Verifier contracts generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
