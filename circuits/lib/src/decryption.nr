// TFHE boolean decryption in-circuit.
//
// Given an LWE sample (a[500], b) and secret key bits s[500],
// computes phase = b - dot(a, s) mod 2^32, then returns true
// iff the phase rounds to the 1/4 quadrant (i.e. decrypts to 1).
//
// Arithmetic: u64 accumulation avoids overflow, then reduce mod 2^32.

/// Compute dot product of a[] and s[], reduce mod 2^32.
pub fn lwe_dot_mod32(a: [u32; 500], s: [u1; 500]) -> u32 {
    // Accumulate in u64 to avoid overflow.
    // Worst case: 500 * 0xFFFFFFFF = ~2.1e12, fits in u64.
    let mut acc: u64 = 0;
    for i in 0..500 {
        acc += (a[i] as u64) * (s[i] as u64);
    }
    // Reduce mod 2^32
    (acc & 0xFFFFFFFF) as u32
}

/// Compute TFHE decryption phase: (b - dot(a, s)) mod 2^32
pub fn lwe_phase(a: [u32; 500], b: u32, s: [u1; 500]) -> u32 {
    let dot = lwe_dot_mod32(a, s);
    // (b - dot) mod 2^32: use u64 to handle underflow
    let phase = ((b as u64) + 0x100000000 - (dot as u64)) & 0xFFFFFFFF;
    phase as u32
}

/// Decrypt a single TFHE boolean: true iff phase is in [0x20000000, 0x60000000)
pub fn decrypt_bool(a: [u32; 500], b: u32, s: [u1; 500]) -> bool {
    let phase = lwe_phase(a, b, s);
    // Phase in the "1" quadrant: 0x20000000 <= phase < 0x60000000
    let lower: u32 = 0x20000000;
    let upper: u32 = 0x60000000;
    (phase >= lower) & (phase < upper)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_dot_zero_key() {
    let a = [1 as u32; 500];
    let s = [0 as u1; 500];
    assert(lwe_dot_mod32(a, s) == 0);
}

#[test]
fn test_dot_all_ones_key() {
    let a = [1 as u32; 500];
    let s = [1 as u1; 500];
    assert(lwe_dot_mod32(a, s) == 500);
}

#[test]
fn test_dot_mod_wrap() {
    // 0xFFFFFFFF * 500 = 0x1F3FFFFFEC4 -> mod 2^32 = 0xFFFFFEC4 - actually let me compute
    // 0xFFFFFFFF = 4294967295
    // 4294967295 * 500 = 2147483647500
    // 2147483647500 mod 4294967296 = 2147483647500 - 500 * 4294967296
    // 500 * 4294967296 = 2147483648000
    // 2147483647500 - 2147483648000 = -500 + 4294967296 = 4294966796
    // 4294966796 = 0xFFFFFE0C
    let a = [0xFFFFFFFF as u32; 500];
    let s = [1 as u1; 500];
    assert(lwe_dot_mod32(a, s) == 0xFFFFFE0C);
}

#[test]
fn test_phase_no_dot() {
    let a = [0 as u32; 500];
    let s = [0 as u1; 500];
    // phase = b - 0 = b
    assert(lwe_phase(a, 42, s) == 42);
}

#[test]
fn test_phase_underflow() {
    let a = [0 as u32; 500];
    let s = [0 as u1; 500];
    // When b = 0 and dot = 0, phase = 0
    assert(lwe_phase(a, 0, s) == 0);
}

#[test]
fn test_decrypt_true() {
    // phase = 0x40000000 (center of "1" quadrant)
    let a = [0 as u32; 500];
    let s = [0 as u1; 500];
    assert(decrypt_bool(a, 0x40000000, s) == true);
}

#[test]
fn test_decrypt_false_zero() {
    // phase = 0 (center of "0" quadrant)
    let a = [0 as u32; 500];
    let s = [0 as u1; 500];
    assert(decrypt_bool(a, 0, s) == false);
}

#[test]
fn test_decrypt_false_high() {
    // phase = 0x80000000 (in the "0" region)
    let a = [0 as u32; 500];
    let s = [0 as u1; 500];
    assert(decrypt_bool(a, 0x80000000, s) == false);
}

#[test]
fn test_decrypt_boundary_lower() {
    // phase = 0x20000000 (inclusive lower bound -> true)
    let a = [0 as u32; 500];
    let s = [0 as u1; 500];
    assert(decrypt_bool(a, 0x20000000, s) == true);
}

#[test]
fn test_decrypt_boundary_upper() {
    // phase = 0x60000000 (exclusive upper bound -> false)
    let a = [0 as u32; 500];
    let s = [0 as u1; 500];
    assert(decrypt_bool(a, 0x60000000, s) == false);
}
