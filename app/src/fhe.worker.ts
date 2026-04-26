// Web Worker that owns all TFHE WASM operations.
// Loads emscripten module, caches entity ciphertexts, runs comparisons off main thread.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = self as any;

interface TFHEModule {
  ccall: (name: string, returnType: string, argTypes: string[], args: unknown[]) => number;
  getValue: (ptr: number, type: string) => number;
  HEAPU8: Uint8Array;
  _tfhe_malloc: (size: number) => number;
  _tfhe_free: (ptr: number) => void;
}

// Emscripten factory attached to global scope by importScripts
declare const createTFHEModule: (opts: { wasmBinary: Uint8Array }) => Promise<TFHEModule>;

let mod: TFHEModule | null = null;
const entityCache = new Map<number, Uint8Array[]>();

// WASM memory helpers

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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Entity ciphertext loading

async function loadEntityCiphertexts(entityId: number): Promise<Uint8Array[]> {
  const cached = entityCache.get(entityId);
  if (cached) return cached;

  const res = await fetch(`/data/entities/${entityId}.bin`);
  if (!res.ok) throw new Error(`Entity ${entityId} ciphertext not found`);
  const data = new Uint8Array(await res.arrayBuffer());

  const sampleSize = mod!.ccall("tfhe_ciphertext_size", "number", [], []);
  const ct8Size = sampleSize * 8;
  const traitCount = data.length / ct8Size;

  const traits: Uint8Array[] = [];
  for (let i = 0; i < traitCount; i++) {
    traits.push(data.slice(i * ct8Size, (i + 1) * ct8Size));
  }
  entityCache.set(entityId, traits);
  return traits;
}

// Message handler

type WorkerRequest =
  | { type: "init"; id: number }
  | { type: "loadCloudKey"; id: number }
  | { type: "compare"; id: number; entityA: number; entityB: number; traitIndex: number };

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as WorkerRequest;
  try {
    switch (msg.type) {
      case "init": {
        post("log", "Loading TFHE WASM module...");
        // Module workers can't use importScripts. Fetch the emscripten glue
        // and run it via indirect eval so its top-level `var createTFHEModule`
        // lands on globalThis (function-scoped eval would lose it).
        const glue = await fetch("/data/tfhe.js").then((r) => r.text());
        (0, eval)(glue);
        const wasmBinary = await fetch("/data/tfhe.wasm").then((r) => r.arrayBuffer());
        mod = await createTFHEModule({ wasmBinary: new Uint8Array(wasmBinary) });
        post("log", "WASM module loaded");
        ctx.postMessage({ type: "ready", id: msg.id });
        break;
      }
      case "loadCloudKey": {
        if (!mod) throw new Error("Call init first");
        post("log", "Loading cloud key (~78 MB)...");
        const ckData = await fetch("/data/cloud.key").then((r) => r.arrayBuffer());
        const ckBytes = new Uint8Array(ckData);
        const ptr = copyToWasm(ckBytes);
        const rc = mod.ccall("tfhe_load_cloud_key", "number", ["number", "number"], [ptr, ckBytes.length]);
        mod._tfhe_free(ptr);
        if (rc !== 0) throw new Error("Failed to load cloud key");
        post("log", `Cloud key loaded (${(ckBytes.length / 1024 / 1024).toFixed(1)} MB)`);
        ctx.postMessage({ type: "cloudKeyLoaded", id: msg.id, sizeBytes: ckBytes.length });
        break;
      }
      case "compare": {
        if (!mod) throw new Error("Call init first");
        const [traitsA, traitsB] = await Promise.all([
          loadEntityCiphertexts(msg.entityA),
          loadEntityCiphertexts(msg.entityB),
        ]);

        if (msg.traitIndex >= traitsA.length || msg.traitIndex >= traitsB.length) {
          throw new Error(`Trait index ${msg.traitIndex} out of range`);
        }

        const a = traitsA[msg.traitIndex];
        const b = traitsB[msg.traitIndex];

        // GT comparison
        const aPtr = copyToWasm(a);
        const bPtr = copyToWasm(b);
        const gtLenPtr = allocOutLen();
        const gtDataPtr = mod.ccall(
          "tfhe_compare_gt", "number",
          ["number", "number", "number", "number", "number"],
          [aPtr, a.length, bPtr, b.length, gtLenPtr],
        );
        const gtLen = readOutLen(gtLenPtr);
        mod._tfhe_free(aPtr);
        mod._tfhe_free(bPtr);
        if (!gtDataPtr || gtLen === 0) throw new Error("GT comparison failed");
        const gtBytes = readFromWasm(gtDataPtr, gtLen);

        // EQ comparison
        const aPtr2 = copyToWasm(a);
        const bPtr2 = copyToWasm(b);
        const eqLenPtr = allocOutLen();
        const eqDataPtr = mod.ccall(
          "tfhe_compare_eq", "number",
          ["number", "number", "number", "number", "number"],
          [aPtr2, a.length, bPtr2, b.length, eqLenPtr],
        );
        const eqLen = readOutLen(eqLenPtr);
        mod._tfhe_free(aPtr2);
        mod._tfhe_free(bPtr2);
        if (!eqDataPtr || eqLen === 0) throw new Error("EQ comparison failed");
        const eqBytes = readFromWasm(eqDataPtr, eqLen);

        ctx.postMessage({
          type: "compareResult",
          id: msg.id,
          entityA: msg.entityA,
          entityB: msg.entityB,
          traitIndex: msg.traitIndex,
          gtHex: toHex(gtBytes),
          eqHex: toHex(eqBytes),
        });
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

function post(type: string, message: string) {
  ctx.postMessage({ type, message });
}
