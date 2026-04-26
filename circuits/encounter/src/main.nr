use lib::commitment::commit_position;
use poseidon::poseidon::bn254::{hash_1, hash_2, hash_3};

/// Encounter proof: proves that a participant is co-located with an
/// entity whose position is derived from a private landscape seed.
///
/// The oracle generates this proof (it knows the seed). The contract
/// verifies on-chain -- no signatures, no grace periods.
///
/// Private inputs: seed, participant position + salt
/// Public inputs:  seed_commitment, entity_id, position_commitment,
///                 grid dims, initial_position_commitment,
///                 blinding_seed_commitment
fn main(
    // Private
    seed: Field,
    participant_x: Field,
    participant_y: Field,
    participant_salt: Field,
    // Public
    seed_commitment: pub Field,
    entity_id: pub Field,
    position_commitment: pub Field,
    grid_width: pub u32,
    grid_height: pub u32,
    initial_position_commitment: pub Field,
    blinding_seed_commitment: pub Field,
) {
    // 1. Seed matches public commitment
    assert(hash_1([seed]) == seed_commitment, "seed commitment mismatch");

    // 2. Derive entity position from seed + entity_id
    let h = hash_2([seed, entity_id]);
    let bits: [u1; 254] = h.to_le_bits();

    // Reconstruct lower 32 bits as u64, then use modular arithmetic.
    // Works for any grid dimensions (not just powers of 2).
    let mut h_low: u64 = 0;
    for i in 0..32 {
        h_low += (bits[i] as u64) << (i as u64);
    }

    let entity_x = (h_low % (grid_width as u64)) as u32;
    let entity_y = ((h_low / (grid_width as u64)) % (grid_height as u64)) as u32;

    assert(entity_x < grid_width, "entity x out of bounds");
    assert(entity_y < grid_height, "entity y out of bounds");

    // 3. Participant is at entity position
    assert(participant_x == entity_x as Field, "participant x mismatch");
    assert(participant_y == entity_y as Field, "participant y mismatch");

    // 4. Participant position commitment is correct
    assert(
        commit_position(participant_x, participant_y, participant_salt) == position_commitment,
        "position commitment mismatch",
    );

    // 5. Blinding seed = h (the hash used for position derivation)
    let blinding_seed = h;
    assert(hash_1([blinding_seed]) == blinding_seed_commitment, "blinding seed commitment mismatch");

    // 6. Entity initial position commitment (for mint)
    let entity_initial_salt = hash_3([blinding_seed, 0, 0]);
    assert(
        commit_position(entity_x as Field, entity_y as Field, entity_initial_salt) == initial_position_commitment,
        "initial position commitment mismatch",
    );
}

// ---------------------------------------------------------------------------
// nargo tests
// ---------------------------------------------------------------------------

fn test_entity_pos(seed: Field, entity_id: Field, gw: u32, gh: u32) -> (u32, u32) {
    let h = hash_2([seed, entity_id]);
    let bits: [u1; 254] = h.to_le_bits();
    let mut h_low: u64 = 0;
    for i in 0..32 {
        h_low += (bits[i] as u64) << (i as u64);
    }
    let x = (h_low % (gw as u64)) as u32;
    let y = ((h_low / (gw as u64)) % (gh as u64)) as u32;
    (x, y)
}

#[test]
fn test_valid_encounter() {
    let seed: Field = 42;
    let entity_id: Field = 5;

    let (ex, ey) = test_entity_pos(seed, entity_id, 32, 32);
    let salt: Field = 999;

    let seed_commitment = hash_1([seed]);
    let position_commitment = commit_position(ex as Field, ey as Field, salt);

    let h = hash_2([seed, entity_id]);
    let blinding_seed = h;
    let blinding_seed_commitment = hash_1([blinding_seed]);
    let entity_initial_salt = hash_3([blinding_seed, 0, 0]);
    let initial_position_commitment = commit_position(ex as Field, ey as Field, entity_initial_salt);

    main(
        seed,
        ex as Field, ey as Field, salt,
        seed_commitment, entity_id, position_commitment,
        32, 32,
        initial_position_commitment, blinding_seed_commitment,
    );
}

#[test(should_fail)]
fn test_wrong_seed() {
    let seed: Field = 42;
    let wrong_seed: Field = 99;
    let entity_id: Field = 5;

    let (ex, ey) = test_entity_pos(seed, entity_id, 32, 32);
    let salt: Field = 999;

    let seed_commitment = hash_1([seed]);
    let position_commitment = commit_position(ex as Field, ey as Field, salt);

    let h = hash_2([seed, entity_id]);
    let blinding_seed_commitment = hash_1([h]);
    let entity_initial_salt = hash_3([h, 0, 0]);
    let initial_position_commitment = commit_position(ex as Field, ey as Field, entity_initial_salt);

    // Use wrong seed -- should fail seed commitment check
    main(
        wrong_seed,
        ex as Field, ey as Field, salt,
        seed_commitment, entity_id, position_commitment,
        32, 32,
        initial_position_commitment, blinding_seed_commitment,
    );
}

#[test(should_fail)]
fn test_wrong_position() {
    let seed: Field = 42;
    let entity_id: Field = 5;

    let (ex, ey) = test_entity_pos(seed, entity_id, 32, 32);
    let salt: Field = 999;

    let seed_commitment = hash_1([seed]);
    // Participant claims to be at (0, 0) but entity is elsewhere
    let fake_x: Field = 0;
    let fake_y: Field = 0;
    let position_commitment = commit_position(fake_x, fake_y, salt);

    let h = hash_2([seed, entity_id]);
    let blinding_seed_commitment = hash_1([h]);
    let entity_initial_salt = hash_3([h, 0, 0]);
    let initial_position_commitment = commit_position(ex as Field, ey as Field, entity_initial_salt);

    main(
        seed,
        fake_x, fake_y, salt,
        seed_commitment, entity_id, position_commitment,
        32, 32,
        initial_position_commitment, blinding_seed_commitment,
    );
}

#[test(should_fail)]
fn test_wrong_position_commitment() {
    let seed: Field = 42;
    let entity_id: Field = 5;

    let (ex, ey) = test_entity_pos(seed, entity_id, 32, 32);
    let salt: Field = 999;
    let wrong_salt: Field = 111;

    let seed_commitment = hash_1([seed]);
    // Commitment uses wrong salt
    let position_commitment = commit_position(ex as Field, ey as Field, wrong_salt);

    let h = hash_2([seed, entity_id]);
    let blinding_seed_commitment = hash_1([h]);
    let entity_initial_salt = hash_3([h, 0, 0]);
    let initial_position_commitment = commit_position(ex as Field, ey as Field, entity_initial_salt);

    main(
        seed,
        ex as Field, ey as Field, salt,
        seed_commitment, entity_id, position_commitment,
        32, 32,
        initial_position_commitment, blinding_seed_commitment,
    );
}

#[test]
fn test_different_entities() {
    let seed: Field = 42;

    // Test multiple entity IDs produce valid proofs
    for eid in 0..4 {
        let entity_id = eid as Field;
        let (ex, ey) = test_entity_pos(seed, entity_id, 32, 32);
        let salt = 1000 + eid as Field;

        let seed_commitment = hash_1([seed]);
        let position_commitment = commit_position(ex as Field, ey as Field, salt);

        let h = hash_2([seed, entity_id]);
        let blinding_seed_commitment = hash_1([h]);
        let entity_initial_salt = hash_3([h, 0, 0]);
        let initial_position_commitment = commit_position(ex as Field, ey as Field, entity_initial_salt);

        main(
            seed,
            ex as Field, ey as Field, salt,
            seed_commitment, entity_id, position_commitment,
            32, 32,
            initial_position_commitment, blinding_seed_commitment,
        );
    }
}

#[test]
fn test_non_square_non_power_of_2_grid() {
    let seed: Field = 42;
    let gw: u32 = 30;
    let gh: u32 = 25;

    for eid in 0..4 {
        let entity_id = eid as Field;
        let (ex, ey) = test_entity_pos(seed, entity_id, gw, gh);
        let salt = 2000 + eid as Field;

        assert(ex < gw, "x out of bounds");
        assert(ey < gh, "y out of bounds");

        let seed_commitment = hash_1([seed]);
        let position_commitment = commit_position(ex as Field, ey as Field, salt);

        let h = hash_2([seed, entity_id]);
        let blinding_seed_commitment = hash_1([h]);
        let entity_initial_salt = hash_3([h, 0, 0]);
        let initial_position_commitment = commit_position(ex as Field, ey as Field, entity_initial_salt);

        main(
            seed,
            ex as Field, ey as Field, salt,
            seed_commitment, entity_id, position_commitment,
            gw, gh,
            initial_position_commitment, blinding_seed_commitment,
        );
    }
}
