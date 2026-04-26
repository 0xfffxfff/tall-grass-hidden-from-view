use poseidon::poseidon::bn254::hash_3;

/// Commit to a grid position: Poseidon(x, y, salt)
/// Used for both participant position commitments and verification.
pub fn commit_position(x: Field, y: Field, salt: Field) -> Field {
    hash_3([x, y, salt])
}
