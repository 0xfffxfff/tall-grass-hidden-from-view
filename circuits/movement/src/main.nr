use lib::commitment::commit_position;
use lib::grid::apply_move;

/// Participant movement proof (SPEC 3.4).
///
/// Proves that two position commitments are consistent with a valid
/// single-step cardinal move on a toroidal grid, without revealing
/// the positions or direction.
///
/// Private inputs: old/new coordinates, salts, direction
/// Public inputs:  old/new commitments, grid_width, grid_height
fn main(
    // Private
    old_x: u32,
    old_y: u32,
    old_salt: Field,
    new_x: u32,
    new_y: u32,
    new_salt: Field,
    direction: u8,
    // Public
    old_commitment: pub Field,
    new_commitment: pub Field,
    grid_width: pub u32,
    grid_height: pub u32,
) {
    // 1. Old commitment matches old position
    assert(
        old_commitment == commit_position(old_x as Field, old_y as Field, old_salt),
        "old commitment mismatch",
    );

    // 2. New commitment matches new position
    assert(
        new_commitment == commit_position(new_x as Field, new_y as Field, new_salt),
        "new commitment mismatch",
    );

    // 3. Direction is valid (enforced inside apply_move, but belt-and-suspenders)
    assert(direction < 4, "invalid direction");

    // 4. New position is exactly one step from old position
    let (expected_x, expected_y) = apply_move(old_x, old_y, direction, grid_width, grid_height);
    assert(new_x == expected_x, "x mismatch after move");
    assert(new_y == expected_y, "y mismatch after move");
}

// ---------------------------------------------------------------------------
// nargo tests
// ---------------------------------------------------------------------------

// Helper: compute commitment in test context
fn test_commit(x: u32, y: u32, salt: Field) -> Field {
    commit_position(x as Field, y as Field, salt)
}

#[test]
fn test_valid_move_north() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(5, 5, salt_old);
    let new_c = test_commit(5, 6, salt_new);
    main(5, 5, salt_old, 5, 6, salt_new, 0, old_c, new_c, 32, 32);
}

#[test]
fn test_valid_move_south() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(5, 5, salt_old);
    let new_c = test_commit(5, 4, salt_new);
    main(5, 5, salt_old, 5, 4, salt_new, 1, old_c, new_c, 32, 32);
}

#[test]
fn test_valid_move_east() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(5, 5, salt_old);
    let new_c = test_commit(6, 5, salt_new);
    main(5, 5, salt_old, 6, 5, salt_new, 2, old_c, new_c, 32, 32);
}

#[test]
fn test_valid_move_west() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(5, 5, salt_old);
    let new_c = test_commit(4, 5, salt_new);
    main(5, 5, salt_old, 4, 5, salt_new, 3, old_c, new_c, 32, 32);
}

#[test]
fn test_wrap_north() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(10, 31, salt_old);
    let new_c = test_commit(10, 0, salt_new);
    main(10, 31, salt_old, 10, 0, salt_new, 0, old_c, new_c, 32, 32);
}

#[test]
fn test_wrap_south() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(10, 0, salt_old);
    let new_c = test_commit(10, 31, salt_new);
    main(10, 0, salt_old, 10, 31, salt_new, 1, old_c, new_c, 32, 32);
}

#[test]
fn test_wrap_east() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(31, 10, salt_old);
    let new_c = test_commit(0, 10, salt_new);
    main(31, 10, salt_old, 0, 10, salt_new, 2, old_c, new_c, 32, 32);
}

#[test]
fn test_wrap_west() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(0, 10, salt_old);
    let new_c = test_commit(31, 10, salt_new);
    main(0, 10, salt_old, 31, 10, salt_new, 3, old_c, new_c, 32, 32);
}

#[test]
fn test_non_square_grid() {
    // 64 wide, 32 tall -- east wrap at x=63
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(63, 10, salt_old);
    let new_c = test_commit(0, 10, salt_new);
    main(63, 10, salt_old, 0, 10, salt_new, 2, old_c, new_c, 64, 32);
}

#[test]
fn test_non_square_grid_y_wrap() {
    // 64 wide, 32 tall -- north wrap at y=31
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(10, 31, salt_old);
    let new_c = test_commit(10, 0, salt_new);
    main(10, 31, salt_old, 10, 0, salt_new, 0, old_c, new_c, 64, 32);
}

#[test(should_fail)]
fn test_invalid_direction() {
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(5, 5, salt_old);
    let new_c = test_commit(5, 5, salt_new);
    main(5, 5, salt_old, 5, 5, salt_new, 4, old_c, new_c, 32, 32);
}

#[test(should_fail)]
fn test_invalid_two_step() {
    // Attempt to move 2 cells east
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(5, 5, salt_old);
    let new_c = test_commit(7, 5, salt_new);
    main(5, 5, salt_old, 7, 5, salt_new, 2, old_c, new_c, 32, 32);
}

#[test(should_fail)]
fn test_wrong_commitment() {
    // Commitment doesn't match position
    let salt_old = 111;
    let salt_new = 222;
    let old_c = test_commit(5, 5, salt_old);
    let fake_c = test_commit(99, 99, salt_new); // wrong position
    main(5, 5, salt_old, 5, 6, salt_new, 0, old_c, fake_c, 32, 32);
}
