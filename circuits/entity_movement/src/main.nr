use lib::commitment::commit_position;
use lib::grid::apply_move;
use poseidon::poseidon::bn254::{hash_1, hash_2, hash_3};

/// Entity movement proof -- owner-controlled, ZK-proved.
///
/// After minting, entity owners move their entities using this circuit.
/// Direction commitments are blinded on-chain so only the oracle (via seed)
/// or the owner (via blinding_seed) can decode them.
///
/// Private inputs: old/new coordinates, direction, blinding_seed
/// Public inputs:  old/new commitments, grid dimensions, direction commitment,
///                 blinding_seed commitment, entity move count
fn main(
    // Private
    old_x: u32,
    old_y: u32,
    new_x: u32,
    new_y: u32,
    direction: u8,
    blinding_seed: Field,
    // Public
    old_commitment: pub Field,
    new_commitment: pub Field,
    grid_width: pub u32,
    grid_height: pub u32,
    direction_commitment: pub Field,
    blinding_seed_commitment: pub Field,
    entity_move_count: pub Field,
) {
    // 1. Derive old salt deterministically: hash_3([blinding_seed, move_count, 0])
    let old_salt = hash_3([blinding_seed, entity_move_count, 0]);

    // 2. Old commitment matches old position
    assert(
        old_commitment == commit_position(old_x as Field, old_y as Field, old_salt),
        "old commitment mismatch",
    );

    // 3. Direction is valid
    assert(direction < 4, "invalid direction");

    // 4. New position is exactly one step from old position
    let (expected_x, expected_y) = apply_move(old_x, old_y, direction, grid_width, grid_height);
    assert(new_x == expected_x, "x mismatch after move");
    assert(new_y == expected_y, "y mismatch after move");

    // 5. Derive new salt: hash_3([blinding_seed, move_count + 1, 0])
    let new_salt = hash_3([blinding_seed, entity_move_count + 1, 0]);

    // 6. New commitment matches new position
    assert(
        new_commitment == commit_position(new_x as Field, new_y as Field, new_salt),
        "new commitment mismatch",
    );

    // 7. Blinding seed commitment matches
    assert(
        hash_1([blinding_seed]) == blinding_seed_commitment,
        "blinding seed commitment mismatch",
    );

    // 8. Direction commitment: hash_2([direction, blinding])
    //    where blinding = hash_2([blinding_seed, entity_move_count])
    let blinding = hash_2([blinding_seed, entity_move_count]);
    assert(
        hash_2([direction as Field, blinding]) == direction_commitment,
        "direction commitment mismatch",
    );
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn test_old_salt(blinding_seed: Field, move_count: Field) -> Field {
    hash_3([blinding_seed, move_count, 0])
}

fn test_new_salt(blinding_seed: Field, move_count: Field) -> Field {
    hash_3([blinding_seed, move_count + 1, 0])
}

fn test_commit(x: u32, y: u32, salt: Field) -> Field {
    commit_position(x as Field, y as Field, salt)
}

fn test_blinding_seed_commitment(blinding_seed: Field) -> Field {
    hash_1([blinding_seed])
}

fn test_direction_commitment(direction: u8, blinding_seed: Field, move_count: Field) -> Field {
    let blinding = hash_2([blinding_seed, move_count]);
    hash_2([direction as Field, blinding])
}

// ---------------------------------------------------------------------------
// Cardinal direction tests
// ---------------------------------------------------------------------------

#[test]
fn test_move_north() {
    let bs: Field = 42;
    let mc: Field = 0;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(5, 6, new_salt);
    let dc = test_direction_commitment(0, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 5, 6, 0, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test]
fn test_move_south() {
    let bs: Field = 42;
    let mc: Field = 0;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(5, 4, new_salt);
    let dc = test_direction_commitment(1, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 5, 4, 1, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test]
fn test_move_east() {
    let bs: Field = 42;
    let mc: Field = 0;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(6, 5, new_salt);
    let dc = test_direction_commitment(2, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 6, 5, 2, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test]
fn test_move_west() {
    let bs: Field = 42;
    let mc: Field = 0;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(4, 5, new_salt);
    let dc = test_direction_commitment(3, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 4, 5, 3, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

// ---------------------------------------------------------------------------
// Toroidal wrapping tests
// ---------------------------------------------------------------------------

#[test]
fn test_wrap_north() {
    let bs: Field = 99;
    let mc: Field = 3;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(10, 31, old_salt);
    let new_c = test_commit(10, 0, new_salt);
    let dc = test_direction_commitment(0, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(10, 31, 10, 0, 0, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test]
fn test_wrap_south() {
    let bs: Field = 99;
    let mc: Field = 5;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(10, 0, old_salt);
    let new_c = test_commit(10, 31, new_salt);
    let dc = test_direction_commitment(1, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(10, 0, 10, 31, 1, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test]
fn test_wrap_east() {
    let bs: Field = 99;
    let mc: Field = 7;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(31, 10, old_salt);
    let new_c = test_commit(0, 10, new_salt);
    let dc = test_direction_commitment(2, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(31, 10, 0, 10, 2, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test]
fn test_wrap_west() {
    let bs: Field = 99;
    let mc: Field = 9;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(0, 10, old_salt);
    let new_c = test_commit(31, 10, new_salt);
    let dc = test_direction_commitment(3, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(0, 10, 31, 10, 3, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

// ---------------------------------------------------------------------------
// Failure cases
// ---------------------------------------------------------------------------

#[test(should_fail)]
fn test_wrong_blinding_seed() {
    let bs: Field = 42;
    let wrong_bs: Field = 43;
    let mc: Field = 0;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(5, 6, new_salt);
    // Use correct direction commitment but wrong blinding_seed in proof
    let dc = test_direction_commitment(0, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 5, 6, 0, wrong_bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test(should_fail)]
fn test_wrong_direction() {
    let bs: Field = 42;
    let mc: Field = 0;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(5, 6, new_salt);
    // Claim direction is east (2) but actually moved north
    let dc = test_direction_commitment(2, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 5, 6, 2, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

#[test(should_fail)]
fn test_wrong_move_count() {
    let bs: Field = 42;
    let mc: Field = 0;
    let wrong_mc: Field = 1;
    // Compute commitments with mc=0 but pass wrong_mc=1 as public input
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(5, 6, new_salt);
    let dc = test_direction_commitment(0, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 5, 6, 0, bs, old_c, new_c, 32, 32, dc, bsc, wrong_mc);
}

#[test(should_fail)]
fn test_invalid_direction() {
    let bs: Field = 42;
    let mc: Field = 0;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(5, 5, old_salt);
    let new_c = test_commit(5, 5, new_salt);
    let dc = test_direction_commitment(4, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(5, 5, 5, 5, 4, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}

// ---------------------------------------------------------------------------
// Non-zero move count test
// ---------------------------------------------------------------------------

#[test]
fn test_nonzero_move_count() {
    let bs: Field = 77;
    let mc: Field = 10;
    let old_salt = test_old_salt(bs, mc);
    let new_salt = test_new_salt(bs, mc);
    let old_c = test_commit(15, 20, old_salt);
    let new_c = test_commit(15, 21, new_salt);
    let dc = test_direction_commitment(0, bs, mc);
    let bsc = test_blinding_seed_commitment(bs);
    main(15, 20, 15, 21, 0, bs, old_c, new_c, 32, 32, dc, bsc, mc);
}
