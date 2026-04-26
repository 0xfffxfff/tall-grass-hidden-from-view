// TFHE WASM wrapper — exposes gate bootstrapping API as C functions
// for emscripten/WASM consumption. Uses C++ stream API internally
// for buffer-based serialization (no FILE* needed).

#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>
#include <emscripten/emscripten.h>

#include "tfhe.h"
#include "tfhe_io.h"
#include "tfhe_gate_bootstrapping_functions.h"
#include "tfhe_gate_bootstrapping_structures.h"

// ---------------------------------------------------------------------------
// Global state — one parameter set, one cloud key loaded at a time.
// The browser only ever runs comparisons (cloud-side operations).
// Key generation, encryption, and decryption happen server-side (native).
// ---------------------------------------------------------------------------

static const TFheGateBootstrappingParameterSet* g_params = nullptr;
static TFheGateBootstrappingCloudKeySet* g_cloud_key = nullptr;
static TFheGateBootstrappingSecretKeySet* g_secret_key = nullptr;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Serialize any object to a malloc'd buffer via its stream export function.
// Caller owns the returned pointer and must free it.
template<typename ExportFn, typename... Args>
static uint8_t* serialize_to_buffer(uint32_t* out_len, ExportFn export_fn, Args... args) {
    std::ostringstream oss(std::ios::binary);
    export_fn(oss, args...);
    std::string data = oss.str();
    *out_len = (uint32_t)data.size();
    uint8_t* buf = (uint8_t*)malloc(data.size());
    if (buf) memcpy(buf, data.data(), data.size());
    return buf;
}

extern "C" {

// ---------------------------------------------------------------------------
// Memory management (called from JS to free buffers)
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void tfhe_free(void* ptr) {
    free(ptr);
}

EMSCRIPTEN_KEEPALIVE
void* tfhe_malloc(uint32_t size) {
    return malloc(size);
}

// ---------------------------------------------------------------------------
// Key generation (primarily for testing — production keys generated natively)
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int tfhe_generate_keys(int32_t security_level) {
    if (g_secret_key) {
        delete_gate_bootstrapping_secret_keyset(g_secret_key);
        g_secret_key = nullptr;
    }
    if (g_cloud_key) {
        // cloud key is embedded in secret key, don't double-free
        g_cloud_key = nullptr;
    }
    if (g_params) {
        delete_gate_bootstrapping_parameters((TFheGateBootstrappingParameterSet*)g_params);
        g_params = nullptr;
    }

    auto* params = new_default_gate_bootstrapping_parameters(security_level);
    if (!params) return -1;

    auto* sk = new_random_gate_bootstrapping_secret_keyset(params);
    if (!sk) {
        delete_gate_bootstrapping_parameters(params);
        return -2;
    }

    g_params = params;
    g_secret_key = sk;
    g_cloud_key = nullptr; // use &sk->cloud for cloud operations
    return 0;
}

// ---------------------------------------------------------------------------
// Cloud key loading (the main browser entry point)
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
int tfhe_load_cloud_key(const uint8_t* data, uint32_t len) {
    if (g_cloud_key) {
        delete_gate_bootstrapping_cloud_keyset(g_cloud_key);
        g_cloud_key = nullptr;
        g_params = nullptr;
    }

    std::string buf((const char*)data, len);
    std::istringstream iss(buf, std::ios::binary);

    auto* ck = new_tfheGateBootstrappingCloudKeySet_fromStream(iss);
    if (!ck) return -1;

    g_cloud_key = ck;
    g_params = ck->params;
    return 0;
}

// ---------------------------------------------------------------------------
// Secret key serialization (for native key gen → export → load in tests)
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
uint8_t* tfhe_export_secret_key(uint32_t* out_len) {
    if (!g_secret_key) { *out_len = 0; return nullptr; }
    return serialize_to_buffer(out_len,
        export_tfheGateBootstrappingSecretKeySet_toStream, g_secret_key);
}

EMSCRIPTEN_KEEPALIVE
int tfhe_load_secret_key(const uint8_t* data, uint32_t len) {
    if (g_secret_key) {
        delete_gate_bootstrapping_secret_keyset(g_secret_key);
        g_secret_key = nullptr;
    }
    if (g_cloud_key) {
        delete_gate_bootstrapping_cloud_keyset(g_cloud_key);
        g_cloud_key = nullptr;
    }
    if (g_params) {
        delete_gate_bootstrapping_parameters((TFheGateBootstrappingParameterSet*)g_params);
        g_params = nullptr;
    }

    std::string buf((const char*)data, len);
    std::istringstream iss(buf, std::ios::binary);

    auto* sk = new_tfheGateBootstrappingSecretKeySet_fromStream(iss);
    if (!sk) return -1;

    g_secret_key = sk;
    g_params = sk->params;
    g_cloud_key = nullptr;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* tfhe_export_cloud_key(uint32_t* out_len) {
    const TFheGateBootstrappingCloudKeySet* ck = g_cloud_key;
    if (!ck && g_secret_key) ck = &g_secret_key->cloud;
    if (!ck) { *out_len = 0; return nullptr; }
    return serialize_to_buffer(out_len,
        export_tfheGateBootstrappingCloudKeySet_toStream, ck);
}

// ---------------------------------------------------------------------------
// Encryption / Decryption (for testing — production uses native)
// ---------------------------------------------------------------------------

// Encrypt an 8-bit value as 8 individual LweSamples.
// Returns a serialized buffer of the 8 ciphertexts.
EMSCRIPTEN_KEEPALIVE
uint8_t* tfhe_encrypt_u8(int32_t plaintext, uint32_t* out_len) {
    if (!g_secret_key || !g_params) { *out_len = 0; return nullptr; }

    LweSample* ct = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        bootsSymEncrypt(&ct[i], (plaintext >> i) & 1, g_secret_key);
    }

    std::ostringstream oss(std::ios::binary);
    for (int i = 0; i < 8; i++) {
        export_gate_bootstrapping_ciphertext_toStream(oss, &ct[i], g_params);
    }

    delete_gate_bootstrapping_ciphertext_array(8, ct);

    std::string data = oss.str();
    *out_len = (uint32_t)data.size();
    uint8_t* buf = (uint8_t*)malloc(data.size());
    if (buf) memcpy(buf, data.data(), data.size());
    return buf;
}

// Decrypt an 8-bit ciphertext (8 LweSamples) to a plaintext value.
EMSCRIPTEN_KEEPALIVE
int32_t tfhe_decrypt_u8(const uint8_t* data, uint32_t len) {
    if (!g_secret_key || !g_params) return -1;

    std::string buf((const char*)data, len);
    std::istringstream iss(buf, std::ios::binary);

    LweSample* ct = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(iss, &ct[i], g_params);
    }

    int32_t result = 0;
    for (int i = 0; i < 8; i++) {
        int bit = bootsSymDecrypt(&ct[i], g_secret_key);
        result |= (bit << i);
    }

    delete_gate_bootstrapping_ciphertext_array(8, ct);
    return result;
}

// Encrypt a single bit. Returns serialized LweSample.
EMSCRIPTEN_KEEPALIVE
uint8_t* tfhe_encrypt_bit(int32_t bit, uint32_t* out_len) {
    if (!g_secret_key || !g_params) { *out_len = 0; return nullptr; }

    LweSample* ct = new_gate_bootstrapping_ciphertext(g_params);
    bootsSymEncrypt(ct, bit & 1, g_secret_key);

    std::ostringstream oss(std::ios::binary);
    export_gate_bootstrapping_ciphertext_toStream(oss, ct, g_params);

    delete_gate_bootstrapping_ciphertext(ct);

    std::string data = oss.str();
    *out_len = (uint32_t)data.size();
    uint8_t* buf = (uint8_t*)malloc(data.size());
    if (buf) memcpy(buf, data.data(), data.size());
    return buf;
}

// Decrypt a single bit.
EMSCRIPTEN_KEEPALIVE
int32_t tfhe_decrypt_bit(const uint8_t* data, uint32_t len) {
    if (!g_secret_key || !g_params) return -1;

    std::string buf((const char*)data, len);
    std::istringstream iss(buf, std::ios::binary);

    LweSample* ct = new_gate_bootstrapping_ciphertext(g_params);
    import_gate_bootstrapping_ciphertext_fromStream(iss, &ct[0], g_params);

    int32_t result = bootsSymDecrypt(ct, g_secret_key);
    delete_gate_bootstrapping_ciphertext(ct);
    return result;
}

// ---------------------------------------------------------------------------
// 8-bit comparison circuits (the core browser operation)
// ---------------------------------------------------------------------------

// Greater-than: returns serialized encrypted bit (1 if a > b, 0 otherwise).
// Uses XNOR + MUX circuit from TFHE tutorial, MSB-first.
// 24 gate bootstrappings total (3 per bit).
EMSCRIPTEN_KEEPALIVE
uint8_t* tfhe_compare_gt(const uint8_t* a_data, uint32_t a_len,
                          const uint8_t* b_data, uint32_t b_len,
                          uint32_t* out_len) {
    const TFheGateBootstrappingCloudKeySet* ck = g_cloud_key;
    if (!ck && g_secret_key) ck = &g_secret_key->cloud;
    if (!ck || !g_params) { *out_len = 0; return nullptr; }

    // Deserialize inputs (8 bits each)
    std::string abuf((const char*)a_data, a_len);
    std::istringstream a_iss(abuf, std::ios::binary);
    LweSample* a = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(a_iss, &a[i], g_params);
    }

    std::string bbuf((const char*)b_data, b_len);
    std::istringstream b_iss(bbuf, std::ios::binary);
    LweSample* b = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(b_iss, &b[i], g_params);
    }

    // Compute a > b using XNOR + MUX, MSB first
    LweSample* result = new_gate_bootstrapping_ciphertext(g_params);
    LweSample* temp = new_gate_bootstrapping_ciphertext(g_params);

    bootsCONSTANT(result, 0, ck); // default: a is not greater

    // LSB to MSB: each higher differing bit overwrites the result,
    // so the most significant difference wins.
    for (int i = 0; i < 8; i++) {
        bootsXNOR(temp, &a[i], &b[i], ck);        // temp = (a[i] == b[i])
        bootsMUX(result, temp, result, &a[i], ck); // if equal: keep; else: a[i]
    }

    // Serialize result
    std::ostringstream oss(std::ios::binary);
    export_gate_bootstrapping_ciphertext_toStream(oss, result, g_params);

    delete_gate_bootstrapping_ciphertext(temp);
    delete_gate_bootstrapping_ciphertext(result);
    delete_gate_bootstrapping_ciphertext_array(8, b);
    delete_gate_bootstrapping_ciphertext_array(8, a);

    std::string data = oss.str();
    *out_len = (uint32_t)data.size();
    uint8_t* buf = (uint8_t*)malloc(data.size());
    if (buf) memcpy(buf, data.data(), data.size());
    return buf;
}

// Equality: returns serialized encrypted bit (1 if a == b, 0 otherwise).
// XNOR each bit pair, AND all results together.
// 15 gate bootstrappings (8 XNOR + 7 AND).
EMSCRIPTEN_KEEPALIVE
uint8_t* tfhe_compare_eq(const uint8_t* a_data, uint32_t a_len,
                          const uint8_t* b_data, uint32_t b_len,
                          uint32_t* out_len) {
    const TFheGateBootstrappingCloudKeySet* ck = g_cloud_key;
    if (!ck && g_secret_key) ck = &g_secret_key->cloud;
    if (!ck || !g_params) { *out_len = 0; return nullptr; }

    // Deserialize
    std::string abuf((const char*)a_data, a_len);
    std::istringstream a_iss(abuf, std::ios::binary);
    LweSample* a = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(a_iss, &a[i], g_params);
    }

    std::string bbuf((const char*)b_data, b_len);
    std::istringstream b_iss(bbuf, std::ios::binary);
    LweSample* b = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(b_iss, &b[i], g_params);
    }

    // XNOR each bit pair, then AND all results
    LweSample* result = new_gate_bootstrapping_ciphertext(g_params);
    LweSample* temp = new_gate_bootstrapping_ciphertext(g_params);

    bootsXNOR(result, &a[0], &b[0], ck); // result = (a[0] == b[0])

    for (int i = 1; i < 8; i++) {
        bootsXNOR(temp, &a[i], &b[i], ck);       // temp = (a[i] == b[i])
        bootsAND(result, result, temp, ck);        // result = result AND temp
    }

    // Serialize result
    std::ostringstream oss(std::ios::binary);
    export_gate_bootstrapping_ciphertext_toStream(oss, result, g_params);

    delete_gate_bootstrapping_ciphertext(temp);
    delete_gate_bootstrapping_ciphertext(result);
    delete_gate_bootstrapping_ciphertext_array(8, b);
    delete_gate_bootstrapping_ciphertext_array(8, a);

    std::string data = oss.str();
    *out_len = (uint32_t)data.size();
    uint8_t* buf = (uint8_t*)malloc(data.size());
    if (buf) memcpy(buf, data.data(), data.size());
    return buf;
}

// ---------------------------------------------------------------------------
// Ciphertext serialization helpers
// ---------------------------------------------------------------------------

// Get the serialized size of a single ciphertext (useful for JS to know offsets)
EMSCRIPTEN_KEEPALIVE
uint32_t tfhe_ciphertext_size() {
    if (!g_params) return 0;

    LweSample* ct = new_gate_bootstrapping_ciphertext(g_params);
    bootsCONSTANT(ct, 0, g_cloud_key ? g_cloud_key : &g_secret_key->cloud);

    std::ostringstream oss(std::ios::binary);
    export_gate_bootstrapping_ciphertext_toStream(oss, ct, g_params);
    delete_gate_bootstrapping_ciphertext(ct);

    return (uint32_t)oss.str().size();
}

// ---------------------------------------------------------------------------
// Progress callback for gate-by-gate visualization
// ---------------------------------------------------------------------------

// JS callback type: void callback(int gates_done, int gates_total)
typedef void (*progress_callback_t)(int, int);
static progress_callback_t g_progress_cb = nullptr;

EMSCRIPTEN_KEEPALIVE
void tfhe_set_progress_callback(progress_callback_t cb) {
    g_progress_cb = cb;
}

// Greater-than with per-gate progress reporting
EMSCRIPTEN_KEEPALIVE
uint8_t* tfhe_compare_gt_progress(const uint8_t* a_data, uint32_t a_len,
                                   const uint8_t* b_data, uint32_t b_len,
                                   uint32_t* out_len) {
    const TFheGateBootstrappingCloudKeySet* ck = g_cloud_key;
    if (!ck && g_secret_key) ck = &g_secret_key->cloud;
    if (!ck || !g_params) { *out_len = 0; return nullptr; }

    const int total_gates = 24; // 3 per bit * 8 bits
    int gates_done = 0;

    // Deserialize inputs
    std::string abuf((const char*)a_data, a_len);
    std::istringstream a_iss(abuf, std::ios::binary);
    LweSample* a = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(a_iss, &a[i], g_params);
    }

    std::string bbuf((const char*)b_data, b_len);
    std::istringstream b_iss(bbuf, std::ios::binary);
    LweSample* b = new_gate_bootstrapping_ciphertext_array(8, g_params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(b_iss, &b[i], g_params);
    }

    LweSample* result = new_gate_bootstrapping_ciphertext(g_params);
    LweSample* temp = new_gate_bootstrapping_ciphertext(g_params);

    bootsCONSTANT(result, 0, ck);

    for (int i = 0; i < 8; i++) {
        bootsXNOR(temp, &a[i], &b[i], ck);
        gates_done++;
        if (g_progress_cb) g_progress_cb(gates_done, total_gates);

        bootsMUX(result, temp, result, &a[i], ck); // MUX = 2 bootstrappings
        gates_done += 2;
        if (g_progress_cb) g_progress_cb(gates_done, total_gates);
    }

    std::ostringstream oss(std::ios::binary);
    export_gate_bootstrapping_ciphertext_toStream(oss, result, g_params);

    delete_gate_bootstrapping_ciphertext(temp);
    delete_gate_bootstrapping_ciphertext(result);
    delete_gate_bootstrapping_ciphertext_array(8, b);
    delete_gate_bootstrapping_ciphertext_array(8, a);

    std::string data = oss.str();
    *out_len = (uint32_t)data.size();
    uint8_t* buf = (uint8_t*)malloc(data.size());
    if (buf) memcpy(buf, data.data(), data.size());
    return buf;
}

// ---------------------------------------------------------------------------
// LWE secret key bit export (for ZK decryption proofs)
// ---------------------------------------------------------------------------

// Export the raw LWE secret key as 500 x int32 (each 0 or 1).
// Writes into caller-provided buffer: 500 * 4 = 2000 bytes, little-endian.
// Returns 0 on success, -1 if no secret key loaded, -2 if buffer too small.
EMSCRIPTEN_KEEPALIVE
int tfhe_export_lwe_key_bits(uint8_t* out_buf, uint32_t buf_len) {
    if (!g_secret_key) return -1;

    const LweKey* lwe_key = g_secret_key->lwe_key;
    int n = lwe_key->params->n; // should be 500

    uint32_t needed = (uint32_t)n * 4;
    if (buf_len < needed) return -2;

    // Each key coefficient is an int32_t (0 or 1 for binary keys).
    // Write as little-endian int32.
    for (int i = 0; i < n; i++) {
        int32_t bit = lwe_key->key[i];
        out_buf[i * 4 + 0] = (uint8_t)(bit & 0xFF);
        out_buf[i * 4 + 1] = (uint8_t)((bit >> 8) & 0xFF);
        out_buf[i * 4 + 2] = (uint8_t)((bit >> 16) & 0xFF);
        out_buf[i * 4 + 3] = (uint8_t)((bit >> 24) & 0xFF);
    }

    return 0;
}

// Get the LWE dimension n (expected: 500 for lambda=80).
EMSCRIPTEN_KEEPALIVE
int tfhe_get_lwe_dimension() {
    if (!g_secret_key) return -1;
    return g_secret_key->lwe_key->params->n;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void tfhe_cleanup() {
    if (g_secret_key) {
        delete_gate_bootstrapping_secret_keyset(g_secret_key);
        g_secret_key = nullptr;
        g_params = nullptr;
        g_cloud_key = nullptr;
    } else {
        if (g_cloud_key) {
            delete_gate_bootstrapping_cloud_keyset(g_cloud_key);
            g_cloud_key = nullptr;
            g_params = nullptr;
        }
    }
}

} // extern "C"
