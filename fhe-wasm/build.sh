#!/bin/bash
# Build TFHE WASM module from the static library + wrapper
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TFHE_SRC="$SCRIPT_DIR/tfhe/src"
BUILD_DIR="$SCRIPT_DIR/build-wasm"
OUT_DIR="$SCRIPT_DIR/dist"

# Ensure emscripten is available
if ! command -v emcc &> /dev/null; then
    if [ -f /tmp/emsdk/emsdk_env.sh ]; then
        source /tmp/emsdk/emsdk_env.sh 2>/dev/null
    else
        echo "Error: emscripten not found. Install emsdk first."
        exit 1
    fi
fi

# Step 1: Build TFHE static library if not already built
if [ ! -f "$BUILD_DIR/libtfhe/libtfhe-nayuki-portable.a" ]; then
    echo "==> Building TFHE static library..."
    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"
    emcmake cmake "$TFHE_SRC" \
        -DENABLE_NAYUKI_PORTABLE=ON \
        -DENABLE_NAYUKI_AVX=OFF \
        -DENABLE_SPQLIOS_AVX=OFF \
        -DENABLE_SPQLIOS_FMA=OFF \
        -DENABLE_FFTW=OFF \
        -DENABLE_TESTS=OFF \
        -DCMAKE_BUILD_TYPE=Release \
        -Wno-dev
    emmake make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)
    cd "$SCRIPT_DIR"
else
    echo "==> TFHE static library already built"
fi

# Step 2: Compile wrapper + link into WASM module
echo "==> Compiling WASM module..."
mkdir -p "$OUT_DIR"

em++ \
    -O2 \
    -std=gnu++11 \
    -I"$TFHE_SRC/include" \
    -o "$OUT_DIR/tfhe.js" \
    "$SCRIPT_DIR/src/wrapper.cpp" \
    "$BUILD_DIR/libtfhe/libtfhe-nayuki-portable.a" \
    -s EXPORTED_FUNCTIONS='[
        "_tfhe_free",
        "_tfhe_malloc",
        "_tfhe_generate_keys",
        "_tfhe_load_cloud_key",
        "_tfhe_export_secret_key",
        "_tfhe_load_secret_key",
        "_tfhe_export_cloud_key",
        "_tfhe_encrypt_u8",
        "_tfhe_decrypt_u8",
        "_tfhe_encrypt_bit",
        "_tfhe_decrypt_bit",
        "_tfhe_compare_gt",
        "_tfhe_compare_eq",
        "_tfhe_compare_gt_progress",
        "_tfhe_ciphertext_size",
        "_tfhe_set_progress_callback",
        "_tfhe_cleanup",
        "_tfhe_get_lwe_dimension",
        "_tfhe_export_lwe_key_bits"
    ]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","addFunction","removeFunction","HEAPU8"]' \
    -s ALLOW_TABLE_GROWTH=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=384MB \
    -s MAXIMUM_MEMORY=4GB \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='createTFHEModule' \
    -s ENVIRONMENT='web,worker,node' \
    -s NO_EXIT_RUNTIME=1 \
    -s STACK_SIZE=1MB \
    --no-entry

echo "==> Build complete"
ls -lh "$OUT_DIR/tfhe.js" "$OUT_DIR/tfhe.wasm"
echo "WASM size: $(wc -c < "$OUT_DIR/tfhe.wasm" | tr -d ' ') bytes"
