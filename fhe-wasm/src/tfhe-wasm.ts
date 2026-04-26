// TypeScript wrapper for the TFHE WASM module.
// Provides a clean async API for FHE operations in the browser.

export interface TFHEModule {
  // Emscripten runtime methods
  ccall: (name: string, returnType: string, argTypes: string[], args: any[]) => any;
  cwrap: (name: string, returnType: string, argTypes: string[]) => (...args: any[]) => any;
  getValue: (ptr: number, type: string) => number;
  setValue: (ptr: number, value: number, type: string) => void;
  addFunction: (fn: Function, signature: string) => number;
  removeFunction: (ptr: number) => void;
  HEAPU8: Uint8Array;
  _tfhe_malloc: (size: number) => number;
  _tfhe_free: (ptr: number) => void;
}

export type ProgressCallback = (gatesDone: number, gatesTotal: number) => void;

// Opaque handles — serialized ciphertext buffers
export type Ciphertext8 = Uint8Array; // 8-bit encrypted integer (8 LweSamples)
export type CiphertextBit = Uint8Array; // single encrypted bit (1 LweSample)
export type CloudKey = Uint8Array;
export type SecretKey = Uint8Array;

let _module: TFHEModule | null = null;

// Load the WASM module. Call once before using any other function.
export async function init(
  moduleFactory?: () => Promise<TFHEModule>
): Promise<void> {
  if (_module) return;

  if (moduleFactory) {
    _module = await moduleFactory();
  } else {
    // Dynamic import of the emscripten glue
    const createModule = (await import("../dist/tfhe.js")).default;
    _module = await createModule();
  }
}

function mod(): TFHEModule {
  if (!_module) throw new Error("TFHE module not initialized. Call init() first.");
  return _module;
}

// Copy a Uint8Array into WASM memory, returning the pointer.
// Caller must free the pointer when done.
function copyToWasm(data: Uint8Array): number {
  const m = mod();
  const ptr = m._tfhe_malloc(data.length);
  if (!ptr) throw new Error("WASM malloc failed");
  m.HEAPU8.set(data, ptr);
  return ptr;
}

// Read bytes from WASM memory into a new Uint8Array and free the WASM buffer.
function readFromWasm(ptr: number, len: number): Uint8Array {
  const m = mod();
  const result = new Uint8Array(m.HEAPU8.buffer, ptr, len).slice();
  m._tfhe_free(ptr);
  return result;
}

// Allocate a uint32 in WASM memory for out-parameters.
function allocOutLen(): number {
  const m = mod();
  const ptr = m._tfhe_malloc(4);
  if (!ptr) throw new Error("WASM malloc failed");
  return ptr;
}

function readOutLen(ptr: number): number {
  const m = mod();
  const val = m.getValue(ptr, "i32");
  m._tfhe_free(ptr);
  return val;
}

// ---------------------------------------------------------------------------
// Key generation (primarily for testing)
// ---------------------------------------------------------------------------

export function generateKeys(securityLevel: number = 80): void {
  const result = mod().ccall("tfhe_generate_keys", "number", ["number"], [securityLevel]);
  if (result !== 0) throw new Error(`Key generation failed: ${result}`);
}

// ---------------------------------------------------------------------------
// Key serialization
// ---------------------------------------------------------------------------

export function exportSecretKey(): SecretKey {
  const m = mod();
  const lenPtr = allocOutLen();
  const dataPtr = m.ccall("tfhe_export_secret_key", "number", ["number"], [lenPtr]);
  const len = readOutLen(lenPtr);
  if (!dataPtr || len === 0) throw new Error("No secret key to export");
  return readFromWasm(dataPtr, len);
}

export function exportCloudKey(): CloudKey {
  const m = mod();
  const lenPtr = allocOutLen();
  const dataPtr = m.ccall("tfhe_export_cloud_key", "number", ["number"], [lenPtr]);
  const len = readOutLen(lenPtr);
  if (!dataPtr || len === 0) throw new Error("No cloud key to export");
  return readFromWasm(dataPtr, len);
}

export function loadSecretKey(key: SecretKey): void {
  const m = mod();
  const ptr = copyToWasm(key);
  const result = m.ccall("tfhe_load_secret_key", "number", ["number", "number"], [ptr, key.length]);
  m._tfhe_free(ptr);
  if (result !== 0) throw new Error(`Failed to load secret key: ${result}`);
}

export function loadCloudKey(key: CloudKey): void {
  const m = mod();
  const ptr = copyToWasm(key);
  const result = m.ccall("tfhe_load_cloud_key", "number", ["number", "number"], [ptr, key.length]);
  m._tfhe_free(ptr);
  if (result !== 0) throw new Error(`Failed to load cloud key: ${result}`);
}

// ---------------------------------------------------------------------------
// Encryption / Decryption
// ---------------------------------------------------------------------------

export function encryptU8(value: number): Ciphertext8 {
  if (value < 0 || value > 255) throw new RangeError("Value must be 0-255");
  const m = mod();
  const lenPtr = allocOutLen();
  const dataPtr = m.ccall("tfhe_encrypt_u8", "number", ["number", "number"], [value, lenPtr]);
  const len = readOutLen(lenPtr);
  if (!dataPtr || len === 0) throw new Error("Encryption failed");
  return readFromWasm(dataPtr, len);
}

export function decryptU8(ct: Ciphertext8): number {
  const m = mod();
  const ptr = copyToWasm(ct);
  const result = m.ccall("tfhe_decrypt_u8", "number", ["number", "number"], [ptr, ct.length]);
  m._tfhe_free(ptr);
  if (result < 0) throw new Error("Decryption failed");
  return result;
}

export function encryptBit(value: 0 | 1): CiphertextBit {
  const m = mod();
  const lenPtr = allocOutLen();
  const dataPtr = m.ccall("tfhe_encrypt_bit", "number", ["number", "number"], [value, lenPtr]);
  const len = readOutLen(lenPtr);
  if (!dataPtr || len === 0) throw new Error("Encryption failed");
  return readFromWasm(dataPtr, len);
}

export function decryptBit(ct: CiphertextBit): 0 | 1 {
  const m = mod();
  const ptr = copyToWasm(ct);
  const result = m.ccall("tfhe_decrypt_bit", "number", ["number", "number"], [ptr, ct.length]);
  m._tfhe_free(ptr);
  if (result < 0) throw new Error("Decryption failed");
  return result as 0 | 1;
}

// ---------------------------------------------------------------------------
// Comparison (the core browser operation)
// ---------------------------------------------------------------------------

export function compareGreaterThan(a: Ciphertext8, b: Ciphertext8): CiphertextBit {
  const m = mod();
  const aPtr = copyToWasm(a);
  const bPtr = copyToWasm(b);
  const lenPtr = allocOutLen();
  const dataPtr = m.ccall(
    "tfhe_compare_gt", "number",
    ["number", "number", "number", "number", "number"],
    [aPtr, a.length, bPtr, b.length, lenPtr]
  );
  const len = readOutLen(lenPtr);
  m._tfhe_free(aPtr);
  m._tfhe_free(bPtr);
  if (!dataPtr || len === 0) throw new Error("Comparison failed");
  return readFromWasm(dataPtr, len);
}

export function compareEqual(a: Ciphertext8, b: Ciphertext8): CiphertextBit {
  const m = mod();
  const aPtr = copyToWasm(a);
  const bPtr = copyToWasm(b);
  const lenPtr = allocOutLen();
  const dataPtr = m.ccall(
    "tfhe_compare_eq", "number",
    ["number", "number", "number", "number", "number"],
    [aPtr, a.length, bPtr, b.length, lenPtr]
  );
  const len = readOutLen(lenPtr);
  m._tfhe_free(aPtr);
  m._tfhe_free(bPtr);
  if (!dataPtr || len === 0) throw new Error("Comparison failed");
  return readFromWasm(dataPtr, len);
}

// Greater-than with per-gate progress reporting.
// The callback fires after each gate bootstrapping (~24 gates for 8-bit comparison).
export function compareGreaterThanWithProgress(
  a: Ciphertext8,
  b: Ciphertext8,
  onProgress: ProgressCallback
): CiphertextBit {
  const m = mod();

  // Register JS callback as a WASM function pointer
  const cbPtr = m.addFunction((done: number, total: number) => {
    onProgress(done, total);
  }, "vii");

  m.ccall("tfhe_set_progress_callback", null, ["number"], [cbPtr]);

  const aPtr = copyToWasm(a);
  const bPtr = copyToWasm(b);
  const lenPtr = allocOutLen();
  const dataPtr = m.ccall(
    "tfhe_compare_gt_progress", "number",
    ["number", "number", "number", "number", "number"],
    [aPtr, a.length, bPtr, b.length, lenPtr]
  );
  const len = readOutLen(lenPtr);
  m._tfhe_free(aPtr);
  m._tfhe_free(bPtr);

  // Clean up callback
  m.ccall("tfhe_set_progress_callback", null, ["number"], [0]);
  m.removeFunction(cbPtr);

  if (!dataPtr || len === 0) throw new Error("Comparison failed");
  return readFromWasm(dataPtr, len);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function ciphertextSize(): number {
  return mod().ccall("tfhe_ciphertext_size", "number", [], []);
}

export function cleanup(): void {
  mod().ccall("tfhe_cleanup", null, [], []);
}

// Convenience: run a full comparison test (generate keys, encrypt, compare, decrypt)
export async function selfTest(): Promise<{
  a: number;
  b: number;
  gt: boolean;
  eq: boolean;
  correct: boolean;
  keyGenMs: number;
  encryptMs: number;
  compareGtMs: number;
  compareEqMs: number;
  decryptMs: number;
}> {
  const a = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);

  const t0 = performance.now();
  generateKeys(80);
  const keyGenMs = performance.now() - t0;

  const t1 = performance.now();
  const ctA = encryptU8(a);
  const ctB = encryptU8(b);
  const encryptMs = performance.now() - t1;

  const t2 = performance.now();
  const gtCt = compareGreaterThan(ctA, ctB);
  const compareGtMs = performance.now() - t2;

  const t3 = performance.now();
  const eqCt = compareEqual(ctA, ctB);
  const compareEqMs = performance.now() - t3;

  const t4 = performance.now();
  const gt = decryptBit(gtCt) === 1;
  const eq = decryptBit(eqCt) === 1;
  const decryptMs = performance.now() - t4;

  const expectedGt = a > b;
  const expectedEq = a === b;
  const correct = gt === expectedGt && eq === expectedEq;

  cleanup();

  return { a, b, gt, eq, correct, keyGenMs, encryptMs, compareGtMs, compareEqMs, decryptMs };
}
