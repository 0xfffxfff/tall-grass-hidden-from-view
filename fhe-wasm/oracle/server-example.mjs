// Oracle comparison endpoint.
//
// Decrypts encrypted comparison results (GT + EQ boolean ciphertexts)
// sent by the browser after homomorphic comparison.
//
// POST /compare { gt: "<hex>", eq: "<hex>" } -> { result: ">" | "<" | "=" }
//
// Config via env:
//   PORT         — Listen port (default 3001)
//   SECRET_KEY   — Path to secret.key file (default ./secret.key)

import { createServer } from "http";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");
const PORT = parseInt(process.env.PORT || "3001", 10);
const SECRET_KEY_PATH = process.env.SECRET_KEY || join(__dirname, "secret.key");

// Load WASM module (same pattern as test-cross.mjs)
const createTFHEModule = createRequire(import.meta.url)(
  join(distDir, "tfhe.js")
);

let Module;

async function init() {
  console.log("Loading TFHE WASM module...");
  Module = await createTFHEModule({
    wasmBinary: readFileSync(join(distDir, "tfhe.wasm")),
  });
  console.log("WASM module loaded.");

  // Load secret key
  console.log(`Loading secret key from ${SECRET_KEY_PATH}...`);
  const skData = readFileSync(SECRET_KEY_PATH);
  const skPtr = Module._tfhe_malloc(skData.length);
  Module.HEAPU8.set(skData, skPtr);
  const rc = Module.ccall(
    "tfhe_load_secret_key",
    "number",
    ["number", "number"],
    [skPtr, skData.length]
  );
  Module._tfhe_free(skPtr);
  if (rc !== 0) throw new Error("Failed to load secret key");
  console.log(
    `Secret key loaded (${(skData.length / 1024 / 1024).toFixed(1)} MB).`
  );
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function decryptBit(ctHex) {
  const ctBytes = hexToBytes(ctHex);
  const ctPtr = Module._tfhe_malloc(ctBytes.length);
  Module.HEAPU8.set(ctBytes, ctPtr);
  const result = Module.ccall(
    "tfhe_decrypt_bit",
    "number",
    ["number", "number"],
    [ctPtr, ctBytes.length]
  );
  Module._tfhe_free(ctPtr);
  return result;
}

function handleCompare(body) {
  const { gt, eq } = JSON.parse(body);
  if (!gt || !eq) {
    return { status: 400, body: { error: "Missing gt or eq field" } };
  }

  const gtBit = decryptBit(gt);
  const eqBit = decryptBit(eq);

  let result;
  if (eqBit === 1) result = "=";
  else if (gtBit === 1) result = ">";
  else result = "<";

  return { status: 200, body: { result } };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function startServer() {
  await init();

  const server = createServer((req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/compare") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { status, body: respBody } = handleCompare(body);
          res.writeHead(status, {
            "Content-Type": "application/json",
            ...corsHeaders(),
          });
          res.end(JSON.stringify(respBody));
        } catch (e) {
          res.writeHead(500, {
            "Content-Type": "application/json",
            ...corsHeaders(),
          });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`Oracle server listening on http://localhost:${PORT}`);
    console.log(`POST /compare { gt: "<hex>", eq: "<hex>" }`);
  });
}

startServer().catch((e) => {
  console.error(e);
  process.exit(1);
});
