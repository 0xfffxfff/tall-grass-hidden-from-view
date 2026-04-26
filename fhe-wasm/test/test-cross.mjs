// Cross-environment test:
// 1. Keys and ciphertexts generated natively (keygen tool)
// 2. Comparison runs in WASM
// 3. Result written to file, decrypted natively
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { performance } from "perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");
const dataDir = join(__dirname, "data");
const keygen = join(__dirname, "..", "build-native", "keygen");

const createTFHEModule = createRequire(import.meta.url)(join(distDir, "tfhe.js"));

async function main() {
  // Load WASM module
  console.log("Loading TFHE WASM module...");
  const Module = await createTFHEModule({
    wasmBinary: readFileSync(join(distDir, "tfhe.wasm")),
  });
  console.log("Module loaded.\n");

  // Load cloud key (generated natively)
  console.log("Loading native-generated cloud key...");
  const cloudKeyData = readFileSync(join(dataDir, "cloud.key"));
  console.log(`  Cloud key size: ${(cloudKeyData.length / 1024 / 1024).toFixed(2)} MB`);

  let t0 = performance.now();
  const ckPtr = Module._tfhe_malloc(cloudKeyData.length);
  Module.HEAPU8.set(cloudKeyData, ckPtr);
  const loadRc = Module.ccall("tfhe_load_cloud_key", "number", ["number", "number"], [ckPtr, cloudKeyData.length]);
  Module._tfhe_free(ckPtr);
  const loadMs = performance.now() - t0;
  if (loadRc !== 0) throw new Error("Failed to load cloud key");
  console.log(`  Cloud key loaded in ${loadMs.toFixed(1)}ms\n`);

  // Load native-encrypted ciphertexts
  const ctA = readFileSync(join(dataDir, "42.ct"));
  const ctB = readFileSync(join(dataDir, "17.ct"));
  console.log(`Loaded ciphertexts: 42.ct (${ctA.length} bytes), 17.ct (${ctB.length} bytes)\n`);

  // Compare in WASM
  console.log("Running comparison in WASM (42 > 17?)...");
  const aPtr = Module._tfhe_malloc(ctA.length);
  Module.HEAPU8.set(ctA, aPtr);
  const bPtr = Module._tfhe_malloc(ctB.length);
  Module.HEAPU8.set(ctB, bPtr);
  const lenPtr = Module._tfhe_malloc(4);

  t0 = performance.now();
  const resultPtr = Module.ccall(
    "tfhe_compare_gt", "number",
    ["number", "number", "number", "number", "number"],
    [aPtr, ctA.length, bPtr, ctB.length, lenPtr]
  );
  const compareMs = performance.now() - t0;
  const resultLen = Module.getValue(lenPtr, "i32");
  Module._tfhe_free(lenPtr);
  Module._tfhe_free(aPtr);
  Module._tfhe_free(bPtr);

  console.log(`  Comparison time: ${compareMs.toFixed(1)}ms`);
  console.log(`  Result ciphertext: ${resultLen} bytes\n`);

  // Write result to file for native decryption
  const resultData = new Uint8Array(Module.HEAPU8.buffer, resultPtr, resultLen).slice();
  Module._tfhe_free(resultPtr);
  writeFileSync(join(dataDir, "result_gt.ct"), resultData);

  // Decrypt natively
  console.log("Decrypting result natively...");
  const decrypted = execSync(`cd "${dataDir}" && "${keygen}" decrypt-bit result_gt.ct`).toString().trim();
  console.log(`  42 > 17 = ${decrypted} (expected 1)\n`);

  const correct = decrypted === "1";

  // Cleanup
  Module.ccall("tfhe_cleanup", null, [], []);

  console.log("========================================");
  console.log(correct ? "CROSS-ENVIRONMENT TEST PASSED" : "CROSS-ENVIRONMENT TEST FAILED");
  console.log("========================================");
  process.exit(correct ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
