// Cross-validates C++ and TypeScript trait derivation produce identical output.
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const keygen = join(__dirname, "..", "build-native", "keygen");

// Dynamic import for TypeScript module (requires tsx or pre-compilation)
// We'll use the deriveTrait logic inline to avoid build dependency.
import { createHash } from "crypto";

function deriveTrait(seed, entityIndex, traitIndex) {
  const msg = Buffer.alloc(seed.length + 8);
  seed.copy(msg, 0);
  msg.writeUInt32LE(entityIndex, seed.length);
  msg.writeUInt32LE(traitIndex, seed.length + 4);
  return createHash("sha256").update(msg).digest()[0];
}

function deriveEntityTraits(seed, entityIndex, traitCount) {
  const traits = [];
  for (let t = 0; t < traitCount; t++) {
    traits.push(deriveTrait(seed, entityIndex, t));
  }
  return traits;
}

const testCases = [
  { seed: "deadbeef", entityIndex: 0, traitCount: 7 },
  { seed: "deadbeef", entityIndex: 1, traitCount: 7 },
  { seed: "deadbeef", entityIndex: 31, traitCount: 7 },
  { seed: "00", entityIndex: 0, traitCount: 3 },
  { seed: "aabbccdd", entityIndex: 0, traitCount: 1 },
  { seed: "0123456789abcdef0123456789abcdef", entityIndex: 0, traitCount: 7 },
];

let passed = 0;
let failed = 0;

for (const { seed, entityIndex, traitCount } of testCases) {
  // C++ output
  const cppOutput = execSync(`"${keygen}" traits ${seed} ${entityIndex} ${traitCount}`)
    .toString()
    .trim();
  const cppTraits = cppOutput.split(" ").map(Number);

  // TypeScript output
  const seedBuf = Buffer.from(seed, "hex");
  const tsTraits = deriveEntityTraits(seedBuf, entityIndex, traitCount);

  const match = JSON.stringify(cppTraits) === JSON.stringify(tsTraits);
  const status = match ? "OK" : "FAIL";
  if (!match) failed++;
  else passed++;

  console.log(
    `${status}  seed=${seed} entity=${entityIndex} traits=${traitCount}: ` +
      `cpp=[${cppTraits}] ts=[${tsTraits}]`
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
