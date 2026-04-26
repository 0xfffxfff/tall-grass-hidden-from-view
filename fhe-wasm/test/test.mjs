// End-to-end test: generate keys, encrypt, compare, decrypt in WASM (Node.js)
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

// Load the emscripten module
const createTFHEModule = createRequire(import.meta.url)(join(distDir, "tfhe.js"));

async function main() {
  console.log("Loading TFHE WASM module...");
  const Module = await createTFHEModule({
    wasmBinary: readFileSync(join(distDir, "tfhe.wasm")),
  });
  console.log("Module loaded.\n");

  // Helper: call a C function that returns a buffer via (ptr, out_len_ptr) pattern
  function callWithBuffer(name, ...args) {
    const lenPtr = Module._tfhe_malloc(4);
    const allArgs = [...args, lenPtr];
    const argTypes = allArgs.map(() => "number");
    const dataPtr = Module.ccall(name, "number", argTypes, allArgs);
    const len = Module.getValue(lenPtr, "i32");
    Module._tfhe_free(lenPtr);
    if (!dataPtr || len === 0) throw new Error(`${name} failed`);
    const result = new Uint8Array(Module.HEAPU8.buffer, dataPtr, len).slice();
    Module._tfhe_free(dataPtr);
    return result;
  }

  function callWithInput(name, ...buffers) {
    const ptrs = [];
    const args = [];
    const argTypes = [];
    for (const buf of buffers) {
      const ptr = Module._tfhe_malloc(buf.length);
      Module.HEAPU8.set(buf, ptr);
      ptrs.push(ptr);
      args.push(ptr, buf.length);
      argTypes.push("number", "number");
    }
    const lenPtr = Module._tfhe_malloc(4);
    args.push(lenPtr);
    argTypes.push("number");

    const dataPtr = Module.ccall(name, "number", argTypes, args);
    const len = Module.getValue(lenPtr, "i32");
    Module._tfhe_free(lenPtr);
    for (const p of ptrs) Module._tfhe_free(p);

    if (!dataPtr || len === 0) throw new Error(`${name} failed`);
    const result = new Uint8Array(Module.HEAPU8.buffer, dataPtr, len).slice();
    Module._tfhe_free(dataPtr);
    return result;
  }

  // --- Key Generation ---
  console.log("Generating keys (lambda=80)...");
  let t0 = performance.now();
  const rc = Module.ccall("tfhe_generate_keys", "number", ["number"], [80]);
  const keyGenMs = performance.now() - t0;
  if (rc !== 0) throw new Error(`Key gen failed: ${rc}`);
  console.log(`  Key generation: ${keyGenMs.toFixed(1)}ms\n`);

  // --- Key export/import test ---
  console.log("Testing key serialization...");
  const secretKeyData = callWithBuffer("tfhe_export_secret_key");
  const cloudKeyData = callWithBuffer("tfhe_export_cloud_key");
  console.log(`  Secret key size: ${(secretKeyData.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Cloud key size:  ${(cloudKeyData.length / 1024 / 1024).toFixed(2)} MB\n`);

  // --- Ciphertext size ---
  const ctSize = Module.ccall("tfhe_ciphertext_size", "number", [], []);
  console.log(`  Single ciphertext size: ${ctSize} bytes`);
  console.log(`  8-bit ciphertext size:  ${ctSize * 8} bytes (${((ctSize * 8) / 1024).toFixed(1)} KB)\n`);

  // --- Encryption ---
  const testCases = [
    [42, 17],   // a > b
    [17, 42],   // a < b
    [100, 100], // a == b
    [0, 255],   // extremes
    [255, 0],   // extremes reversed
  ];

  let allCorrect = true;

  for (const [a, b] of testCases) {
    console.log(`--- Comparing ${a} vs ${b} ---`);

    // Encrypt
    t0 = performance.now();
    const ctA = callWithBuffer("tfhe_encrypt_u8", a);
    const ctB = callWithBuffer("tfhe_encrypt_u8", b);
    const encMs = performance.now() - t0;
    console.log(`  Encrypt: ${encMs.toFixed(1)}ms (${ctA.length} bytes each)`);

    // Compare gt
    t0 = performance.now();
    const gtCt = callWithInput("tfhe_compare_gt", ctA, ctB);
    const gtMs = performance.now() - t0;

    // Compare eq
    t0 = performance.now();
    const eqCt = callWithInput("tfhe_compare_eq", ctA, ctB);
    const eqMs = performance.now() - t0;

    console.log(`  Compare GT: ${gtMs.toFixed(1)}ms`);
    console.log(`  Compare EQ: ${eqMs.toFixed(1)}ms`);

    // Decrypt results
    const gtPtr = Module._tfhe_malloc(gtCt.length);
    Module.HEAPU8.set(gtCt, gtPtr);
    const gtVal = Module.ccall("tfhe_decrypt_bit", "number", ["number", "number"], [gtPtr, gtCt.length]);
    Module._tfhe_free(gtPtr);

    const eqPtr = Module._tfhe_malloc(eqCt.length);
    Module.HEAPU8.set(eqCt, eqPtr);
    const eqVal = Module.ccall("tfhe_decrypt_bit", "number", ["number", "number"], [eqPtr, eqCt.length]);
    Module._tfhe_free(eqPtr);

    const expectedGt = a > b ? 1 : 0;
    const expectedEq = a === b ? 1 : 0;
    const gtCorrect = gtVal === expectedGt;
    const eqCorrect = eqVal === expectedEq;

    console.log(`  GT result: ${gtVal} (expected ${expectedGt}) ${gtCorrect ? "OK" : "FAIL"}`);
    console.log(`  EQ result: ${eqVal} (expected ${expectedEq}) ${eqCorrect ? "OK" : "FAIL"}`);
    console.log();

    if (!gtCorrect || !eqCorrect) allCorrect = false;
  }

  // --- Key reload test: export cloud key, reload, compare again ---
  console.log("--- Cross-environment test: reload cloud key, compare ---");
  Module.ccall("tfhe_cleanup", null, [], []);

  // Reload secret key (for encrypt/decrypt)
  let skPtr = Module._tfhe_malloc(secretKeyData.length);
  Module.HEAPU8.set(secretKeyData, skPtr);
  let loadRc = Module.ccall("tfhe_load_secret_key", "number", ["number", "number"], [skPtr, secretKeyData.length]);
  Module._tfhe_free(skPtr);
  if (loadRc !== 0) throw new Error("Failed to reload secret key");

  // Encrypt with reloaded key
  const ctA2 = callWithBuffer("tfhe_encrypt_u8", 200);
  const ctB2 = callWithBuffer("tfhe_encrypt_u8", 50);

  // Now clear and load only cloud key (simulating browser context)
  Module.ccall("tfhe_cleanup", null, [], []);
  let ckPtr = Module._tfhe_malloc(cloudKeyData.length);
  Module.HEAPU8.set(cloudKeyData, ckPtr);
  loadRc = Module.ccall("tfhe_load_cloud_key", "number", ["number", "number"], [ckPtr, cloudKeyData.length]);
  Module._tfhe_free(ckPtr);
  if (loadRc !== 0) throw new Error("Failed to reload cloud key");

  // Compare with cloud key only
  const gtCt2 = callWithInput("tfhe_compare_gt", ctA2, ctB2);

  // Reload secret key to decrypt
  Module.ccall("tfhe_cleanup", null, [], []);
  skPtr = Module._tfhe_malloc(secretKeyData.length);
  Module.HEAPU8.set(secretKeyData, skPtr);
  loadRc = Module.ccall("tfhe_load_secret_key", "number", ["number", "number"], [skPtr, secretKeyData.length]);
  Module._tfhe_free(skPtr);

  const gt2Ptr = Module._tfhe_malloc(gtCt2.length);
  Module.HEAPU8.set(gtCt2, gt2Ptr);
  const gt2Val = Module.ccall("tfhe_decrypt_bit", "number", ["number", "number"], [gt2Ptr, gtCt2.length]);
  Module._tfhe_free(gt2Ptr);

  const crossCorrect = gt2Val === 1; // 200 > 50
  console.log(`  200 > 50: ${gt2Val} (expected 1) ${crossCorrect ? "OK" : "FAIL"}\n`);
  if (!crossCorrect) allCorrect = false;

  // Cleanup
  Module.ccall("tfhe_cleanup", null, [], []);

  // Summary
  console.log("========================================");
  console.log(allCorrect ? "ALL TESTS PASSED" : "SOME TESTS FAILED");
  console.log("========================================");
  process.exit(allCorrect ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
