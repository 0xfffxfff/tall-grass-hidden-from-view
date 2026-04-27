// TFHE key generation + encryption CLI tool.
// Generates keys, encrypts values, decrypts results, derives traits,
// and runs the full batch encryption pipeline.
//
// Usage:
//   keygen                          Generate keys -> secret.key, cloud.key
//   keygen encrypt <value>          Encrypt 8-bit value -> value.ct
//   keygen decrypt <file>           Decrypt ciphertext file -> stdout
//   keygen encrypt-bit <0|1>        Encrypt single bit -> bit.ct
//   keygen decrypt-bit <file>       Decrypt bit ciphertext -> stdout
//   keygen traits <seed_hex> <entity_index> <trait_count>
//                                   Derive trait values from seed
//   keygen batch <seed_hex> <entity_count> <trait_count> [output_dir]
//                                   Full pipeline: keygen + derive + encrypt all

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <chrono>
#include <vector>
#include <sys/stat.h>
#include "sha256.h"
#include "tfhe.h"
#include "tfhe_io.h"
#include "tfhe_gate_bootstrapping_functions.h"
#include "tfhe_gate_bootstrapping_structures.h"

using namespace std;
using clk = chrono::high_resolution_clock;

// --- Hex utilities ---

static bool hex_to_bytes(const char* hex, vector<uint8_t>& out) {
    size_t len = strlen(hex);
    if (len % 2 != 0) return false;
    out.resize(len / 2);
    for (size_t i = 0; i < len; i += 2) {
        unsigned byte;
        if (sscanf(hex + i, "%2x", &byte) != 1) return false;
        out[i / 2] = (uint8_t)byte;
    }
    return true;
}

// Seed TFHE's PRNG from /dev/urandom. Without it the keyset is deterministic.
// Call before every new_random_gate_bootstrapping_secret_keyset.
static void seed_tfhe_prng() {
    uint32_t seed[16];
    ifstream urandom("/dev/urandom", ios::binary);
    if (!urandom) {
        fprintf(stderr, "Error: /dev/urandom unavailable\n");
        exit(1);
    }
    urandom.read(reinterpret_cast<char*>(seed), sizeof(seed));
    if (urandom.gcount() != sizeof(seed)) {
        fprintf(stderr, "Error: short read from /dev/urandom\n");
        exit(1);
    }
    urandom.close();
    tfhe_random_generator_setSeed(seed, 16);
}

static void bytes_to_hex(const uint8_t* data, size_t len, char* out) {
    for (size_t i = 0; i < len; i++)
        snprintf(out + i * 2, 3, "%02x", data[i]);
    out[len * 2] = '\0';
}

// --- Trait derivation ---

// Per-trait moduli: I..VII map to trait_index 0..6.
// Loaded at runtime from the TRAIT_MODULI env var (e.g. "N1,N2,...").
// Kept out of source so the schema (which trait is binary, etc.) stays private;
// commitment to these values is bound on-chain via traitModuliCommitment.
static uint16_t TRAIT_MODULI[16];
static uint32_t TRAIT_MODULI_COUNT = 0;

static void load_trait_moduli() {
    if (TRAIT_MODULI_COUNT > 0) return; // already loaded
    const char* env = getenv("TRAIT_MODULI");
    if (!env || !*env) {
        fprintf(stderr, "Error: TRAIT_MODULI env var required (e.g. \"N1,N2,...\")\n");
        exit(1);
    }
    string s(env);
    size_t pos = 0;
    while (pos < s.size() && TRAIT_MODULI_COUNT < 16) {
        size_t comma = s.find(',', pos);
        string tok = s.substr(pos, (comma == string::npos ? s.size() : comma) - pos);
        int v = atoi(tok.c_str());
        if (v < 1 || v > 65535) {
            fprintf(stderr, "Error: TRAIT_MODULI value out of range: %s\n", tok.c_str());
            exit(1);
        }
        TRAIT_MODULI[TRAIT_MODULI_COUNT++] = (uint16_t)v;
        if (comma == string::npos) break;
        pos = comma + 1;
    }
    if (TRAIT_MODULI_COUNT == 0) {
        fprintf(stderr, "Error: TRAIT_MODULI parsed to zero values\n");
        exit(1);
    }
}

// SHA-256(seed || entity_index_le32 || trait_index_le32)[0] mod TRAIT_MODULI[trait_index]
static uint8_t derive_trait(const vector<uint8_t>& seed, uint32_t entity_index, uint32_t trait_index) {
    load_trait_moduli();
    vector<uint8_t> msg(seed.size() + 8);
    memcpy(msg.data(), seed.data(), seed.size());
    // Little-endian u32
    msg[seed.size() + 0] = (uint8_t)(entity_index);
    msg[seed.size() + 1] = (uint8_t)(entity_index >> 8);
    msg[seed.size() + 2] = (uint8_t)(entity_index >> 16);
    msg[seed.size() + 3] = (uint8_t)(entity_index >> 24);
    msg[seed.size() + 4] = (uint8_t)(trait_index);
    msg[seed.size() + 5] = (uint8_t)(trait_index >> 8);
    msg[seed.size() + 6] = (uint8_t)(trait_index >> 16);
    msg[seed.size() + 7] = (uint8_t)(trait_index >> 24);
    uint8_t hash[32];
    sha256(msg.data(), msg.size(), hash);
    uint16_t mod = (trait_index < TRAIT_MODULI_COUNT) ? TRAIT_MODULI[trait_index] : 256;
    return (uint8_t)(hash[0] % mod);
}

// --- Usage ---

static void usage(const char* prog) {
    fprintf(stderr, "Usage:\n");
    fprintf(stderr, "  %s                        Generate keys\n", prog);
    fprintf(stderr, "  %s encrypt <value>         Encrypt 8-bit value (0-255)\n", prog);
    fprintf(stderr, "  %s decrypt <file>          Decrypt 8-bit ciphertext\n", prog);
    fprintf(stderr, "  %s encrypt-bit <0|1>       Encrypt single bit\n", prog);
    fprintf(stderr, "  %s decrypt-bit <file>      Decrypt single bit\n", prog);
    fprintf(stderr, "  %s traits <seed_hex> <entity_index> <trait_count>\n", prog);
    fprintf(stderr, "                              Derive trait values\n");
    fprintf(stderr, "  %s batch <seed_hex> <entity_count> <trait_count> [output_dir]\n", prog);
    fprintf(stderr, "                              Full pipeline\n");
    exit(1);
}

// --- Key management ---

static void cmd_keygen() {
    auto t0 = clk::now();

    seed_tfhe_prng();
    auto* params = new_default_gate_bootstrapping_parameters(80);
    auto* sk = new_random_gate_bootstrapping_secret_keyset(params);

    auto t1 = clk::now();
    double keygen_ms = chrono::duration<double, milli>(t1 - t0).count();
    fprintf(stderr, "Key generation: %.1f ms\n", keygen_ms);

    // Export secret key
    {
        ofstream f("secret.key", ios::binary);
        export_tfheGateBootstrappingSecretKeySet_toStream(f, sk);
        f.close();
        fprintf(stderr, "Secret key: secret.key\n");
    }

    // Export cloud key
    {
        ofstream f("cloud.key", ios::binary);
        export_tfheGateBootstrappingCloudKeySet_toStream(f, &sk->cloud);
        f.close();
        fprintf(stderr, "Cloud key:  cloud.key\n");
    }

    delete_gate_bootstrapping_secret_keyset(sk);
    delete_gate_bootstrapping_parameters(params);
}

static TFheGateBootstrappingSecretKeySet* load_secret_key() {
    ifstream f("secret.key", ios::binary);
    if (!f.good()) {
        fprintf(stderr, "Error: secret.key not found. Run keygen first.\n");
        exit(1);
    }
    auto* sk = new_tfheGateBootstrappingSecretKeySet_fromStream(f);
    if (!sk) {
        fprintf(stderr, "Error: failed to parse secret.key\n");
        exit(1);
    }
    return sk;
}

// --- Encrypt / Decrypt ---

static void cmd_encrypt(int value) {
    if (value < 0 || value > 255) {
        fprintf(stderr, "Error: value must be 0-255\n");
        exit(1);
    }

    auto* sk = load_secret_key();
    const auto* params = sk->params;

    LweSample* ct = new_gate_bootstrapping_ciphertext_array(8, params);
    for (int i = 0; i < 8; i++) {
        bootsSymEncrypt(&ct[i], (value >> i) & 1, sk);
    }

    char filename[64];
    snprintf(filename, sizeof(filename), "%d.ct", value);
    ofstream f(filename, ios::binary);
    for (int i = 0; i < 8; i++) {
        export_gate_bootstrapping_ciphertext_toStream(f, &ct[i], params);
    }
    f.close();

    fprintf(stderr, "Encrypted %d -> %s\n", value, filename);

    delete_gate_bootstrapping_ciphertext_array(8, ct);
    delete_gate_bootstrapping_secret_keyset(sk);
}

static void cmd_decrypt(const char* filename) {
    auto* sk = load_secret_key();
    const auto* params = sk->params;

    ifstream f(filename, ios::binary);
    if (!f.good()) {
        fprintf(stderr, "Error: %s not found\n", filename);
        exit(1);
    }

    LweSample* ct = new_gate_bootstrapping_ciphertext_array(8, params);
    for (int i = 0; i < 8; i++) {
        import_gate_bootstrapping_ciphertext_fromStream(f, &ct[i], params);
    }
    f.close();

    int32_t result = 0;
    for (int i = 0; i < 8; i++) {
        int bit = bootsSymDecrypt(&ct[i], sk);
        result |= (bit << i);
    }

    printf("%d\n", result);

    delete_gate_bootstrapping_ciphertext_array(8, ct);
    delete_gate_bootstrapping_secret_keyset(sk);
}

static void cmd_encrypt_bit(int value) {
    auto* sk = load_secret_key();
    const auto* params = sk->params;

    LweSample* ct = new_gate_bootstrapping_ciphertext(params);
    bootsSymEncrypt(ct, value & 1, sk);

    const char* filename = value ? "bit1.ct" : "bit0.ct";
    ofstream f(filename, ios::binary);
    export_gate_bootstrapping_ciphertext_toStream(f, ct, params);
    f.close();

    fprintf(stderr, "Encrypted bit %d -> %s\n", value & 1, filename);

    delete_gate_bootstrapping_ciphertext(ct);
    delete_gate_bootstrapping_secret_keyset(sk);
}

static void cmd_decrypt_bit(const char* filename) {
    auto* sk = load_secret_key();
    const auto* params = sk->params;

    ifstream f(filename, ios::binary);
    if (!f.good()) {
        fprintf(stderr, "Error: %s not found\n", filename);
        exit(1);
    }

    LweSample* ct = new_gate_bootstrapping_ciphertext(params);
    import_gate_bootstrapping_ciphertext_fromStream(f, ct, params);
    f.close();

    int32_t result = bootsSymDecrypt(ct, sk);
    printf("%d\n", result);

    delete_gate_bootstrapping_ciphertext(ct);
    delete_gate_bootstrapping_secret_keyset(sk);
}

// --- Trait derivation command ---

static void cmd_traits(const char* seed_hex, uint32_t entity_index, uint32_t trait_count) {
    vector<uint8_t> seed;
    if (!hex_to_bytes(seed_hex, seed)) {
        fprintf(stderr, "Error: invalid hex seed\n");
        exit(1);
    }

    for (uint32_t t = 0; t < trait_count; t++) {
        uint8_t val = derive_trait(seed, entity_index, t);
        if (t > 0) printf(" ");
        printf("%d", val);
    }
    printf("\n");
}

// --- Batch pipeline ---

static void mkdirp(const string& path) {
    mkdir(path.c_str(), 0755);
}

static void cmd_batch(const char* seed_hex, uint32_t entity_count, uint32_t trait_count, const char* output_dir) {
    vector<uint8_t> seed;
    if (!hex_to_bytes(seed_hex, seed)) {
        fprintf(stderr, "Error: invalid hex seed\n");
        exit(1);
    }

    string dir(output_dir);
    mkdirp(dir);
    mkdirp(dir + "/entities");

    // 1. Generate keys
    fprintf(stderr, "Generating keys...\n");
    auto t0 = clk::now();

    seed_tfhe_prng();
    auto* params = new_default_gate_bootstrapping_parameters(80);
    auto* sk = new_random_gate_bootstrapping_secret_keyset(params);

    auto t1 = clk::now();
    fprintf(stderr, "  Key generation: %.1f ms\n", chrono::duration<double, milli>(t1 - t0).count());

    {
        string path = dir + "/secret.key";
        ofstream f(path.c_str(), ios::binary);
        export_tfheGateBootstrappingSecretKeySet_toStream(f, sk);
        f.close();
        fprintf(stderr, "  -> %s\n", path.c_str());
    }
    {
        string path = dir + "/cloud.key";
        ofstream f(path.c_str(), ios::binary);
        export_tfheGateBootstrappingCloudKeySet_toStream(f, &sk->cloud);
        f.close();
        fprintf(stderr, "  -> %s\n", path.c_str());
    }

    // 2. Derive traits + encrypt + write per-entity files
    fprintf(stderr, "Encrypting %u entities x %u traits...\n", entity_count, trait_count);
    auto t_enc_start = clk::now();

    // We'll collect manifest data as we go
    // JSON will be built manually (no JSON library needed for this simple structure)
    ostringstream manifest;
    manifest << "{\n";
    manifest << "  \"seed\": \"" << seed_hex << "\",\n";
    manifest << "  \"entityCount\": " << entity_count << ",\n";
    manifest << "  \"traitCount\": " << trait_count << ",\n";
    manifest << "  \"entities\": [\n";

    for (uint32_t e = 0; e < entity_count; e++) {
        auto t_ent_start = clk::now();

        // Derive traits for this entity
        vector<uint8_t> traits(trait_count);
        for (uint32_t t = 0; t < trait_count; t++) {
            traits[t] = derive_trait(seed, e, t);
        }

        // Encrypt all traits and write to a single file
        char entity_filename[256];
        snprintf(entity_filename, sizeof(entity_filename), "%s/entities/%u.bin", output_dir, e);
        ofstream ef(entity_filename, ios::binary);

        for (uint32_t t = 0; t < trait_count; t++) {
            LweSample* ct = new_gate_bootstrapping_ciphertext_array(8, params);
            for (int b = 0; b < 8; b++) {
                bootsSymEncrypt(&ct[b], (traits[t] >> b) & 1, sk);
            }
            for (int b = 0; b < 8; b++) {
                export_gate_bootstrapping_ciphertext_toStream(ef, &ct[b], params);
            }
            delete_gate_bootstrapping_ciphertext_array(8, ct);
        }
        ef.close();

        // Compute SHA-256 of entity file
        ifstream hf(entity_filename, ios::binary);
        hf.seekg(0, ios::end);
        size_t fsize = hf.tellg();
        hf.seekg(0, ios::beg);
        vector<uint8_t> fbuf(fsize);
        hf.read((char*)fbuf.data(), fsize);
        hf.close();

        uint8_t file_hash[32];
        sha256(fbuf.data(), fbuf.size(), file_hash);
        char hash_hex[65];
        bytes_to_hex(file_hash, 32, hash_hex);

        auto t_ent_end = clk::now();
        double ent_ms = chrono::duration<double, milli>(t_ent_end - t_ent_start).count();
        fprintf(stderr, "  Entity %u: [", e);
        for (uint32_t t = 0; t < trait_count; t++) {
            if (t > 0) fprintf(stderr, ", ");
            fprintf(stderr, "%d", traits[t]);
        }
        fprintf(stderr, "] -> %zu bytes (%.1f ms)\n", fsize, ent_ms);

        // Add to manifest
        if (e > 0) manifest << ",\n";
        manifest << "    {\n";
        manifest << "      \"id\": " << e << ",\n";
        manifest << "      \"traits\": [";
        for (uint32_t t = 0; t < trait_count; t++) {
            if (t > 0) manifest << ", ";
            manifest << (int)traits[t];
        }
        manifest << "],\n";
        manifest << "      \"sha256\": \"" << hash_hex << "\",\n";
        manifest << "      \"file\": \"entities/" << e << ".bin\",\n";
        manifest << "      \"size\": " << fsize << "\n";
        manifest << "    }";
    }

    manifest << "\n  ]\n";
    manifest << "}\n";

    auto t_enc_end = clk::now();
    double enc_ms = chrono::duration<double, milli>(t_enc_end - t_enc_start).count();
    fprintf(stderr, "Encryption complete: %.1f ms total\n", enc_ms);

    // Write manifest
    string manifest_path = dir + "/manifest.json";
    ofstream mf(manifest_path.c_str());
    mf << manifest.str();
    mf.close();
    fprintf(stderr, "  -> %s\n", manifest_path.c_str());

    delete_gate_bootstrapping_secret_keyset(sk);
    delete_gate_bootstrapping_parameters(params);
}

// --- Main ---

int main(int argc, char** argv) {
    if (argc == 1) {
        cmd_keygen();
    } else if (argc == 3 && strcmp(argv[1], "encrypt") == 0) {
        cmd_encrypt(atoi(argv[2]));
    } else if (argc == 3 && strcmp(argv[1], "decrypt") == 0) {
        cmd_decrypt(argv[2]);
    } else if (argc == 3 && strcmp(argv[1], "encrypt-bit") == 0) {
        cmd_encrypt_bit(atoi(argv[2]));
    } else if (argc == 3 && strcmp(argv[1], "decrypt-bit") == 0) {
        cmd_decrypt_bit(argv[2]);
    } else if (argc == 5 && strcmp(argv[1], "traits") == 0) {
        cmd_traits(argv[2], (uint32_t)atoi(argv[3]), (uint32_t)atoi(argv[4]));
    } else if ((argc == 5 || argc == 6) && strcmp(argv[1], "batch") == 0) {
        const char* out = (argc == 6) ? argv[5] : "output";
        cmd_batch(argv[2], (uint32_t)atoi(argv[3]), (uint32_t)atoi(argv[4]), out);
    } else {
        usage(argv[0]);
    }
    return 0;
}
