/// Direction encoding (canonical for all circuits, oracle, and frontend):
///   0 = North (y + 1)
///   1 = South (y - 1)
///   2 = East  (x + 1)
///   3 = West  (x - 1)
///
/// Coordinate system: x increases eastward, y increases northward.
/// Grid is toroidal -- movement wraps on both axes.
/// Non-square grids supported: x wraps at grid_width, y wraps at grid_height.

/// Apply a single-step move on a toroidal grid.
/// Returns (new_x, new_y).
///
/// Underflow-safe: south/west at coordinate 0 wraps to dimension - 1
/// using explicit branching (u32 subtraction would panic in Noir).
pub fn apply_move(x: u32, y: u32, direction: u8, grid_width: u32, grid_height: u32) -> (u32, u32) {
    assert(direction < 4, "direction must be 0..3");

    let mut new_x = x;
    let mut new_y = y;

    if direction == 0 {
        // North: y + 1, wrap at grid_height
        if y == grid_height - 1 {
            new_y = 0;
        } else {
            new_y = y + 1;
        }
    } else if direction == 1 {
        // South: y - 1, wrap at grid_height
        if y == 0 {
            new_y = grid_height - 1;
        } else {
            new_y = y - 1;
        }
    } else if direction == 2 {
        // East: x + 1, wrap at grid_width
        if x == grid_width - 1 {
            new_x = 0;
        } else {
            new_x = x + 1;
        }
    } else {
        // West: x - 1, wrap at grid_width
        if x == 0 {
            new_x = grid_width - 1;
        } else {
            new_x = x - 1;
        }
    }

    (new_x, new_y)
}
