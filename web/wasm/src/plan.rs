//! The work partition each level would use, as JSON for the step-through demo.
//!
//! These functions call the core crate's own plan functions (`row_block_plan`,
//! `tile_plan`), so what the page draws is exactly what the levels run. Sizes are
//! display sizes: the page asks about a few rows and columns, never a real
//! multiplication, so every argument is validated and bounded here and an error is
//! returned instead of a panic (the threaded build is `panic=abort`).

use std::num::NonZeroUsize;

use hardware_aware_matmul::simd::{micro_tile_shape, target_vector_isa};
use hardware_aware_matmul::streaming::{tile_plan, StreamConfig};
use hardware_aware_matmul::threaded::row_block_plan;

/// The largest `rows`, `inner`, `cols` and tile edge accepted, so the JSON stays small.
pub const MAX_DIM: usize = 64;
/// The most threads (jobs) accepted.
pub const MAX_THREADS: usize = 8;

fn bounded(name: &str, value: usize, max: usize) -> Result<usize, String> {
    if (1..=max).contains(&value) {
        Ok(value)
    } else {
        Err(format!("{name} must be in 1..={max}, got {value}"))
    }
}

fn ranges(ranges: impl Iterator<Item = std::ops::Range<usize>>) -> String {
    let items: Vec<String> = ranges.map(|r| format!("[{},{}]", r.start, r.end)).collect();
    format!("[{}]", items.join(","))
}

/// The partition of an `rows × inner` by `inner × cols` product at `level` (0 to 5).
///
/// Levels 0 to 4 give `{"kind":"rows","blocks":[[start,end],...]}` from
/// [`row_block_plan`] (level 0 is one block, whatever `threads` is). Level 5 gives
/// `{"kind":"tiles","tiles":[{"rows":[a,b],"cols":[a,b]},...],"depth":[[a,b],...],
/// "workers":w}` from [`tile_plan`] with the given tile shape; `workers` is the
/// number of workers the level starts (the thread count, capped at the number of
/// tiles). The tile arguments are ignored by the other levels.
#[allow(clippy::too_many_arguments)]
pub fn partition_plan_json(
    level: u32,
    rows: usize,
    inner: usize,
    cols: usize,
    threads: usize,
    tile_rows: usize,
    tile_cols: usize,
    tile_depth: usize,
) -> Result<String, String> {
    let rows = bounded("rows", rows, MAX_DIM)?;
    let inner = bounded("inner", inner, MAX_DIM)?;
    let cols = bounded("cols", cols, MAX_DIM)?;
    let threads = bounded("threads", threads, MAX_THREADS)?;
    let workers = NonZeroUsize::new(threads).expect("bounded to at least 1");
    match level {
        0 => Ok(format!("{{\"kind\":\"rows\",\"blocks\":[[0,{rows}]]}}")),
        1..=4 => {
            let blocks = ranges(row_block_plan(rows, workers).into_iter());
            Ok(format!("{{\"kind\":\"rows\",\"blocks\":{blocks}}}"))
        }
        5 => {
            let tile_rows = bounded("tile_rows", tile_rows, MAX_DIM)?;
            let tile_cols = bounded("tile_cols", tile_cols, MAX_DIM)?;
            let tile_depth = bounded("tile_depth", tile_depth, MAX_DIM)?;
            let config = StreamConfig::new(workers).with_tile_shape(tile_rows, tile_cols, tile_depth);
            let plan = tile_plan(rows, inner, cols, &config);
            let tiles: Vec<String> = plan
                .tiles
                .iter()
                .map(|t| {
                    format!(
                        "{{\"rows\":[{},{}],\"cols\":[{},{}]}}",
                        t.rows.start, t.rows.end, t.cols.start, t.cols.end
                    )
                })
                .collect();
            let running = threads.min(plan.tiles.len());
            let depth = ranges(plan.depth_slices.into_iter());
            Ok(format!(
                "{{\"kind\":\"tiles\",\"tiles\":[{}],\"depth\":{depth},\"workers\":{running}}}",
                tiles.join(",")
            ))
        }
        other => Err(format!("level must be 0 to 5, got {other}")),
    }
}

/// What this build is: `{"isa":"SSE2","micro_tile":[4,4],"threads":false}`.
///
/// `isa` and `micro_tile` come from the core crate for the target the module was
/// compiled for; `threads` is whether this is the threaded build.
pub fn env_info_json() -> String {
    let (mr, nr) = micro_tile_shape();
    format!(
        "{{\"isa\":\"{}\",\"micro_tile\":[{mr},{nr}],\"threads\":{}}}",
        target_vector_isa(),
        cfg!(feature = "threads")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_one_splits_ten_rows_over_four_threads() {
        // The example from `row_block_plan`'s own documentation.
        assert_eq!(
            partition_plan_json(1, 10, 6, 6, 4, 1, 1, 1).unwrap(),
            r#"{"kind":"rows","blocks":[[0,3],[3,6],[6,9],[9,10]]}"#
        );
    }

    #[test]
    fn levels_two_to_four_use_the_same_row_blocks() {
        let one = partition_plan_json(1, 10, 6, 6, 4, 1, 1, 1).unwrap();
        assert_eq!(partition_plan_json(2, 10, 6, 6, 4, 1, 1, 1).unwrap(), one);
        assert_eq!(partition_plan_json(3, 10, 6, 6, 4, 1, 1, 1).unwrap(), one);
        assert_eq!(partition_plan_json(4, 10, 6, 6, 4, 1, 1, 1).unwrap(), one);
    }

    #[test]
    fn level_zero_is_one_block_whatever_the_threads() {
        assert_eq!(
            partition_plan_json(0, 10, 6, 6, 8, 1, 1, 1).unwrap(),
            r#"{"kind":"rows","blocks":[[0,10]]}"#
        );
    }

    #[test]
    fn more_threads_than_rows_gives_one_row_per_block() {
        assert_eq!(
            partition_plan_json(1, 3, 4, 4, 8, 1, 1, 1).unwrap(),
            r#"{"kind":"rows","blocks":[[0,1],[1,2],[2,3]]}"#
        );
    }

    #[test]
    fn level_five_lists_tiles_in_claim_order_and_depth_slices() {
        // The example from `tile_plan`'s documentation: a 2 x 2 grid of 2 x 3 tiles.
        assert_eq!(
            partition_plan_json(5, 4, 6, 6, 2, 2, 3, 4).unwrap(),
            concat!(
                r#"{"kind":"tiles","tiles":["#,
                r#"{"rows":[0,2],"cols":[0,3]},{"rows":[0,2],"cols":[3,6]},"#,
                r#"{"rows":[2,4],"cols":[0,3]},{"rows":[2,4],"cols":[3,6]}],"#,
                r#""depth":[[0,4],[4,6]],"workers":2}"#
            )
        );
    }

    #[test]
    fn level_five_starts_no_more_workers_than_tiles() {
        let json = partition_plan_json(5, 4, 4, 4, 8, 4, 4, 4).unwrap();
        assert!(json.contains(r#""workers":1"#), "{json}");
    }

    #[test]
    fn level_five_clips_the_edge_tiles() {
        let json = partition_plan_json(5, 5, 4, 5, 1, 4, 4, 4).unwrap();
        assert!(json.contains(r#"{"rows":[4,5],"cols":[4,5]}"#), "{json}");
    }

    #[test]
    fn bad_arguments_are_errors_not_panics() {
        for (args, needle) in [
            ((6, 4, 4, 4, 1, 1, 1, 1), "level must be 0 to 5"),
            ((1, 0, 4, 4, 1, 1, 1, 1), "rows must be in 1..=64"),
            ((1, 4, 65, 4, 1, 1, 1, 1), "inner must be in 1..=64"),
            ((1, 4, 4, 0, 1, 1, 1, 1), "cols must be in 1..=64"),
            ((1, 4, 4, 4, 0, 1, 1, 1), "threads must be in 1..=8"),
            ((1, 4, 4, 4, 9, 1, 1, 1), "threads must be in 1..=8"),
            ((5, 4, 4, 4, 1, 0, 1, 1), "tile_rows must be in 1..=64"),
            ((5, 4, 4, 4, 1, 1, 0, 1), "tile_cols must be in 1..=64"),
            ((5, 4, 4, 4, 1, 1, 1, 65), "tile_depth must be in 1..=64"),
        ] {
            let (l, r, i, c, t, tr, tc, td) = args;
            let err = partition_plan_json(l, r, i, c, t, tr, tc, td).unwrap_err();
            assert!(err.contains(needle), "{args:?}: {err}");
        }
    }

    #[test]
    fn the_other_levels_ignore_the_tile_arguments() {
        // Zero tile arguments are fine for levels 0 to 4.
        assert!(partition_plan_json(2, 4, 4, 4, 2, 0, 0, 0).is_ok());
    }

    #[test]
    fn env_info_matches_the_core_crate() {
        let (mr, nr) = micro_tile_shape();
        let json = env_info_json();
        assert!(json.contains(&format!("\"isa\":\"{}\"", target_vector_isa())), "{json}");
        assert!(json.contains(&format!("\"micro_tile\":[{mr},{nr}]")), "{json}");
        assert!(json.ends_with(&format!("\"threads\":{}}}", cfg!(feature = "threads"))), "{json}");
    }
}
