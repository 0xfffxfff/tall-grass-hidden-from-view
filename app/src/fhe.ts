// Browser-side FHE operations.
// Loads the TFHE WASM module + cloud key, runs homomorphic comparisons.

interface TFHEModule {
  ccall: (
    name: string,
    returnType: string,
    argTypes: string[],
    args: unknown[],
  ) => number;
  getValue: (ptr: number, type: string) => number;
  HEAPU8: Uint8Array;
  _tfhe_malloc: (size: number) => number;
  _tfhe_free: (ptr: number) => void;
}

let mod: TFHEModule | null = null;

function copyToWasm(data: Uint8Array): number {
  const ptr = mod!._tfhe_malloc(data.length);
  if (!ptr) throw new Error("WASM malloc failed");
  mod!.HEAPU8.set(data, ptr);
  return ptr;
}

function readFromWasm(ptr: number, len: number): Uint8Array {
  const result = new Uint8Array(mod!.HEAPU8.buffer, ptr, len).slice();
  mod!._tfhe_free(ptr);
  return result;
}

function allocOutLen(): number {
  const ptr = mod!._tfhe_malloc(4);
  if (!ptr) throw new Error("WASM malloc failed");
  return ptr;
}

function readOutLen(ptr: number): number {
  const val = mod!.getValue(ptr, "i32");
  mod!._tfhe_free(ptr);
  return val;
}

// Load the TFHE WASM module. Call once before using compare functions.
export async function initFHE(): Promise<void> {
  if (mod) return;

  // Load the emscripten glue script
  const wasmBinary = await fetch("/data/tfhe.wasm").then((r) => r.arrayBuffer());

  // Load the JS glue as a script tag (UMD/MODULARIZE pattern)
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/data/tfhe.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load tfhe.js"));
    document.head.appendChild(script);
  });

  // createTFHEModule is now globally available
  const factory = (window as unknown as Record<string, unknown>)[
    "createTFHEModule"
  ] as (opts: { wasmBinary: Uint8Array }) => Promise<TFHEModule>;
  if (!factory) throw new Error("createTFHEModule not found on window");

  mod = await factory({ wasmBinary: new Uint8Array(wasmBinary) });
}

// Load the cloud key (public, ~78 MB). Required before comparisons.
export async function loadCloudKey(): Promise<number> {
  if (!mod) throw new Error("Call initFHE() first");

  const ckData = await fetch("/data/cloud.key").then((r) => r.arrayBuffer());
  const ckBytes = new Uint8Array(ckData);
  const ptr = copyToWasm(ckBytes);
  const rc = mod.ccall(
    "tfhe_load_cloud_key",
    "number",
    ["number", "number"],
    [ptr, ckBytes.length],
  );
  mod._tfhe_free(ptr);
  if (rc !== 0) throw new Error("Failed to load cloud key");
  return ckBytes.length;
}

// Load an entity's ciphertext file. Returns array of 8-bit ciphertexts (one per trait).
export async function loadEntityCiphertexts(
  entityId: number,
): Promise<Uint8Array[]> {
  const res = await fetch(`/data/entities/${entityId}.bin`);
  if (!res.ok) throw new Error(`Entity ${entityId} ciphertext not found`);
  const data = new Uint8Array(await res.arrayBuffer());

  // Each 8-bit ciphertext = 8 LweSamples. Get single sample size from WASM.
  const sampleSize = mod!.ccall("tfhe_ciphertext_size", "number", [], []);
  const ct8Size = sampleSize * 8;
  const traitCount = data.length / ct8Size;

  const traits: Uint8Array[] = [];
  for (let i = 0; i < traitCount; i++) {
    traits.push(data.slice(i * ct8Size, (i + 1) * ct8Size));
  }
  return traits;
}

// Run homomorphic greater-than comparison. Returns encrypted bit.
export function compareGT(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!mod) throw new Error("Call initFHE() first");
  const aPtr = copyToWasm(a);
  const bPtr = copyToWasm(b);
  const lenPtr = allocOutLen();
  const dataPtr = mod.ccall(
    "tfhe_compare_gt",
    "number",
    ["number", "number", "number", "number", "number"],
    [aPtr, a.length, bPtr, b.length, lenPtr],
  );
  const len = readOutLen(lenPtr);
  mod._tfhe_free(aPtr);
  mod._tfhe_free(bPtr);
  if (!dataPtr || len === 0) throw new Error("GT comparison failed");
  return readFromWasm(dataPtr, len);
}

// Run homomorphic equality comparison. Returns encrypted bit.
export function compareEQ(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!mod) throw new Error("Call initFHE() first");
  const aPtr = copyToWasm(a);
  const bPtr = copyToWasm(b);
  const lenPtr = allocOutLen();
  const dataPtr = mod.ccall(
    "tfhe_compare_eq",
    "number",
    ["number", "number", "number", "number", "number"],
    [aPtr, a.length, bPtr, b.length, lenPtr],
  );
  const len = readOutLen(lenPtr);
  mod._tfhe_free(aPtr);
  mod._tfhe_free(bPtr);
  if (!dataPtr || len === 0) throw new Error("EQ comparison failed");
  return readFromWasm(dataPtr, len);
}

// Convert Uint8Array to hex string
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
