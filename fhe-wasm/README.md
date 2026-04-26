# fhe-wasm

FHE (fully homomorphic encryption) pipeline for entity trait encryption and comparison. Built on the [original TFHE C library](https://github.com/tfhe/tfhe) (Apache 2.0) compiled to WebAssembly via emscripten.

## How it works

The artist runs a batch pipeline once before deployment: generate FHE keys, derive trait values from a secret seed, encrypt every trait, and build a Merkle tree for on-chain verification. Encrypted entity ciphertexts and the cloud key go to IPFS. The secret key stays with the oracle.

In the browser, a participant downloads the cloud key and two encrypted entity ciphertexts, then runs homomorphic greater-than and equality comparisons — without ever seeing plaintext values. The encrypted boolean results go to the oracle, which decrypts and returns `>`, `<`, or `=`.

## Secret domains

Three independent secrets, none of which interact cryptographically:

1. **Landscape state** (ZK, separate from this module) — positions, movements, encounter conditions. Committed as Poseidon hashes on-chain, proved with Noir circuits. The artist holds witness data and generates proofs on behalf of participants.

2. **Trait seed** (FHE) — deterministic source for all entity trait values. `SHA-256(seed || entity_index_le32 || trait_index_le32)[0]` gives each trait as a u8 (0-255). The artist picks the seed once; the oracle uses it to reproduce trait values without storing them. Never published.

3. **FHE secret key** — TFHE decryption key (~78 MB). Held by the oracle. Used only to decrypt the boolean comparison results (GT/EQ ciphertexts) sent back by the browser.

The smart contract is the meeting point: it stores both the movement state root (from ZK) and the entity trait Merkle root (from FHE).

## Architecture

```
Pre-deployment (once)           Browser (per comparison)        Oracle (per comparison)
────────────────────────        ────────────────────────        ────────────────────────
keygen batch <seed> 32 7        load cloud key from IPFS        POST /compare
  -> secret.key                 load entity ciphertexts           decrypt GT bit
  -> cloud.key     ──────►     compare_gt(a, b)                  decrypt EQ bit
  -> entities/*.bin ─────►     compare_eq(a, b)  ──────────►    return ">" | "<" | "="
  -> manifest.json
merkle.ts
  -> merkle.json (root + proofs)
     root ──────► contract constructor
```

## Security

Using 80-bit security parameters (the TFHE C library offers only 80 and 128). Acceptable for this art context where encrypted data has limited lifetime and no financial value.

## Prerequisites

- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (tested with 5.0.0)
- CMake 3.0+
- C++ compiler (for native keygen tool)
- Node.js 18+ (for tests, merkle tree, oracle)

## Build

### WASM module

```bash
# Install and activate emscripten (if not already)
git clone https://github.com/niccokunzmann/emsdk.git /tmp/emsdk
cd /tmp/emsdk && ./emsdk install latest && ./emsdk activate latest
source /tmp/emsdk/emsdk_env.sh

# Build WASM
cd fhe-wasm
bash build.sh
```

This produces:
- `dist/tfhe.js` — emscripten glue (~65 KB)
- `dist/tfhe.wasm` — WASM binary (~198 KB)

### Native keygen tool

```bash
# Build TFHE as a native shared library
mkdir -p build-native && cd build-native
cmake ../tfhe/src \
    -DENABLE_NAYUKI_PORTABLE=ON \
    -DENABLE_NAYUKI_AVX=OFF \
    -DENABLE_SPQLIOS_AVX=OFF \
    -DENABLE_SPQLIOS_FMA=OFF \
    -DENABLE_FFTW=OFF \
    -DENABLE_TESTS=OFF \
    -DCMAKE_BUILD_TYPE=Release
make -j$(sysctl -n hw.ncpu)
cd ..

# Compile keygen
c++ -O2 -std=gnu++11 -I tfhe/src/include \
    -o build-native/keygen src/keygen.cpp \
    -L build-native/libtfhe -ltfhe-nayuki-portable \
    -Wl,-rpath,@executable_path/libtfhe
```

### Install Node.js dependencies

```bash
npm install
```

## Pre-deployment pipeline

### 1. Batch encrypt

Generate keys, derive traits from seed, encrypt everything:

```bash
./build-native/keygen batch <seed_hex> <entity_count> <trait_count> [output_dir]

# Example: 32 entities, 7 traits each
./build-native/keygen batch $(openssl rand -hex 32) 32 7 ./output
```

Output:
- `output/secret.key` — TFHE secret key (~78 MB). Keep private (oracle only).
- `output/cloud.key` — TFHE cloud key (~78 MB). Publish to IPFS.
- `output/entities/*.bin` — Encrypted entity ciphertexts (~110 KB each). Publish to IPFS.
- `output/manifest.json` — Seed, plaintext trait values, SHA-256 hashes. Keep private.

### 2. Build Merkle tree

Compute keccak256 of each entity ciphertext file and build a Merkle tree:

```bash
npx tsx src/merkle.ts ./output
```

Output:
- `output/merkle.json` — Root hash + per-entity `{ id, ciphertextHash, proof }`.
- The `root` goes to the contract constructor as `_entityTraitMerkleRoot`.
- Each entity's `ciphertextHash` is the `_entityTraitHash` passed to `mint()`.

The tree uses `StandardMerkleTree.of(values, ["uint256", "bytes32"])` — sorted-pair double-hash, compatible with solady's `MerkleProofLib`.

### 3. Start oracle

```bash
SECRET_KEY=./output/secret.key node oracle/server.mjs
```

Listens on port 3001 (configurable via `PORT` env var). The browser POSTs encrypted comparison results and gets back `>`, `<`, or `=`.

## Individual commands

```bash
# Generate keys only (to current directory)
./build-native/keygen

# Derive trait values (no encryption)
./build-native/keygen traits <seed_hex> <entity_index> <trait_count>

# Encrypt / decrypt individual values
./build-native/keygen encrypt 42          # -> 42.ct
./build-native/keygen decrypt 42.ct       # -> prints 42
./build-native/keygen encrypt-bit 1       # -> bit1.ct
./build-native/keygen decrypt-bit bit1.ct # -> prints 1
```

## Test

```bash
# Cross-validate C++ and TypeScript trait derivation
node test/test-traits.mjs

# Full WASM pipeline: keygen, encrypt, compare, decrypt
node test/test.mjs

# Cross-environment: native keygen/encrypt, WASM compare, native decrypt
node test/test-cross.mjs

# Browser test page
npx serve .
# Then open http://localhost:3000/test/
```

## Directory structure

```
fhe-wasm/
  src/
    keygen.cpp        Native CLI: keygen, encrypt, decrypt, traits, batch
    wrapper.cpp       WASM wrapper exposing TFHE gate bootstrapping as C functions
    tfhe-wasm.ts      TypeScript API for the WASM module (browser)
    sha256.h          Portable header-only SHA-256 (public domain)
    traits.ts         TypeScript trait derivation (Node.js)
    merkle.ts         Merkle tree generator (keccak256, OZ StandardMerkleTree)
  oracle/
    server.mjs        Oracle comparison endpoint (Node.js HTTP server)
  dist/
    tfhe.js           Emscripten glue (built)
    tfhe.wasm         WASM binary (built)
  test/
    test.mjs          Node.js end-to-end test
    test-cross.mjs    Cross-environment test (native keys, WASM comparison)
    test-traits.mjs   Trait derivation cross-validation (C++ vs TypeScript)
    index.html        Browser test page with benchmarks
    data/             Pre-generated keys and ciphertexts for cross-env test
  tfhe/               TFHE C library source (vendored)
  build-wasm/         Emscripten build artifacts (generated)
  build-native/       Native build artifacts (generated)
  build.sh            WASM build script
  package.json        Node.js dependencies
```

## WASM API

| Function | Purpose |
|---|---|
| `tfhe_generate_keys(lambda)` | Generate key pair (for testing; production uses native) |
| `tfhe_load_cloud_key(data, len)` | Load serialized cloud key (browser entry point) |
| `tfhe_load_secret_key(data, len)` | Load serialized secret key (for decryption) |
| `tfhe_encrypt_u8(value, out_len)` | Encrypt 8-bit value as 8 LweSample ciphertexts |
| `tfhe_decrypt_u8(data, len)` | Decrypt 8-bit ciphertext to plaintext |
| `tfhe_compare_gt(a, a_len, b, b_len, out_len)` | Homomorphic a > b (24 gate bootstrappings) |
| `tfhe_compare_eq(a, a_len, b, b_len, out_len)` | Homomorphic a == b (15 gate bootstrappings) |
| `tfhe_compare_gt_progress(...)` | GT with per-gate progress callback |
| `tfhe_decrypt_bit(data, len)` | Decrypt single encrypted bit |
| `tfhe_cleanup()` | Free all loaded keys |

## Performance (M1 Max, WASM via Node.js, lambda=80)

| Metric | Value |
|---|---|
| Key generation | ~460ms |
| Cloud key size | 78 MB |
| 8-bit ciphertext | 15.8 KB |
| Entity (7 traits) | ~110 KB |
| 32 entities total | ~3.5 MB |
| GT comparison (24 gates) | ~1.5s (~62ms/gate) |
| EQ comparison (15 gates) | ~1.0s (~62ms/gate) |
| GT + EQ total | ~2.5s per trait |
| WASM binary | 198 KB |
| WASM memory (runtime) | ~461 MB |
| Batch encrypt (4 entities x 7 traits) | ~10ms |

Browser (Chrome, M1 Max) is similar: GT ~1.5s, EQ ~0.9s.
