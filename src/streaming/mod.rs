#![doc = include_str!("../../docs/levels/streaming.md")]

mod kernel;
pub mod multiply;
pub mod tile;

#[cfg(any(unix, windows))]
pub mod file;

#[cfg(any(unix, windows))]
pub use file::FileMatrix;
pub use multiply::{
    matmul, matmul_streaming, matmul_streaming_with_runner, tile_plan, OutputTile, StreamConfig,
    TilePlan,
};
pub use tile::{MemorySink, TileSink, TileSource};
