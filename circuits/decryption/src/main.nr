use lib::decryption::decrypt_bool;
use poseidon::poseidon::bn254::hash_2;

/// Decryption proof: proves that two TFHE boolean decryptions (GT and EQ
/// comparison results) were performed correctly under a committed secret key.
///
/// The oracle generates this proof after decrypting. The browser verifies
/// locally using bb.js -- no on-chain verification needed.
///
/// Private inputs: s (500 LWE secret key bits)
/// Public inputs:  LWE samples (a[], b) for GT and EQ results,
///                 claimed decryption results, key commitment
fn main(
    // Private: TFHE LWE secret key (500 binary values)
    s: [u1; 500],

    // Public: GT result LweSample
    gt_a: pub [u32; 500],
    gt_b: pub u32,

    // Public: EQ result LweSample
    eq_a: pub [u32; 500],
    eq_b: pub u32,

    // Public: oracle's claimed decryption results
    claimed_gt: pub bool,
    claimed_eq: pub bool,

    // Public: Poseidon commitment to the secret key
    key_commitment: pub Field,
) {
    // 1. Verify key commitment.
    //    Pack 500 bits into two Field elements (250 bits each),
    //    then hash with Poseidon hash_2.
    let mut packed_lo: Field = 0;
    let mut packed_hi: Field = 0;

    // Pack s[0..249] into packed_lo
    for i in 0..250 {
        packed_lo += (s[i] as Field) * (2 as Field).pow_32(i as Field);
    }

    // Pack s[250..499] into packed_hi
    for i in 0..250 {
        packed_hi += (s[250 + i] as Field) * (2 as Field).pow_32(i as Field);
    }

    assert(hash_2([packed_lo, packed_hi]) == key_commitment, "key commitment mismatch");

    // 2. Verify GT decryption
    let gt_result = decrypt_bool(gt_a, gt_b, s);
    assert(gt_result == claimed_gt, "GT decryption mismatch");

    // 3. Verify EQ decryption
    let eq_result = decrypt_bool(eq_a, eq_b, s);
    assert(eq_result == claimed_eq, "EQ decryption mismatch");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_valid_decryption_both_false() {
    // Zero key, phases at 0 (false) for both
    let s = [0 as u1; 500];
    let a = [0 as u32; 500];

    // Compute key commitment
    let packed_lo: Field = 0;
    let packed_hi: Field = 0;
    let kc = hash_2([packed_lo, packed_hi]);

    main(s, a, 0, a, 0, false, false, kc);
}

#[test]
fn test_valid_decryption_gt_true() {
    let s = [0 as u1; 500];
    let a = [0 as u32; 500];

    let packed_lo: Field = 0;
    let packed_hi: Field = 0;
    let kc = hash_2([packed_lo, packed_hi]);

    // GT phase in "1" quadrant, EQ phase at 0
    main(s, a, 0x40000000, a, 0, true, false, kc);
}

#[test]
fn test_valid_decryption_eq_true() {
    let s = [0 as u1; 500];
    let a = [0 as u32; 500];

    let packed_lo: Field = 0;
    let packed_hi: Field = 0;
    let kc = hash_2([packed_lo, packed_hi]);

    // GT at 0, EQ phase in "1" quadrant
    main(s, a, 0, a, 0x40000000, false, true, kc);
}

#[test(should_fail)]
fn test_wrong_gt_claim() {
    let s = [0 as u1; 500];
    let a = [0 as u32; 500];

    let packed_lo: Field = 0;
    let packed_hi: Field = 0;
    let kc = hash_2([packed_lo, packed_hi]);

    // Phase is 0 (false) but claim true -- should fail
    main(s, a, 0, a, 0, true, false, kc);
}

#[test(should_fail)]
fn test_wrong_eq_claim() {
    let s = [0 as u1; 500];
    let a = [0 as u32; 500];

    let packed_lo: Field = 0;
    let packed_hi: Field = 0;
    let kc = hash_2([packed_lo, packed_hi]);

    // EQ phase is 0 (false) but claim true -- should fail
    main(s, a, 0, a, 0, false, true, kc);
}

#[test(should_fail)]
fn test_wrong_key_commitment() {
    let s = [0 as u1; 500];
    let a = [0 as u32; 500];

    // Wrong commitment
    let kc: Field = 12345;

    main(s, a, 0, a, 0, false, false, kc);
}

#[test]
fn test_nonzero_key() {
    // Key with first bit set
    let mut s = [0 as u1; 500];
    s[0] = 1;

    // With s[0]=1 and a[0]=X, dot = X, phase = (b - X) mod 2^32
    // Set a[0] = 0 for simplicity, rest zero: dot = 0, phase = b
    let a = [0 as u32; 500];

    // Compute key commitment with s[0]=1
    let packed_lo: Field = 1; // 2^0 = 1
    let packed_hi: Field = 0;
    let kc = hash_2([packed_lo, packed_hi]);

    main(s, a, 0, a, 0, false, false, kc);
}

#[test]
fn test_key_affects_decryption() {
    // Key with s[0] = 1, a[0] = 0x40000000 for GT
    // dot = 0x40000000, b = 0x80000000
    // phase = 0x80000000 - 0x40000000 = 0x40000000 -> true
    let mut s = [0 as u1; 500];
    s[0] = 1;

    let mut gt_a = [0 as u32; 500];
    gt_a[0] = 0x40000000;

    let eq_a = [0 as u32; 500];

    let packed_lo: Field = 1;
    let packed_hi: Field = 0;
    let kc = hash_2([packed_lo, packed_hi]);

    main(s, gt_a, 0x80000000, eq_a, 0, true, false, kc);
}
