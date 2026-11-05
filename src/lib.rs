#![doc = include_str!("../docs/introduction.md")]
#![forbid(unsafe_code)]
#![warn(missing_docs, rustdoc::broken_intra_doc_links)]

pub mod error;
pub mod matrix;

// The five implementations, in order of increasing sophistication. Each
// module's documentation is the chapter of the story that introduces it.
pub mod cache_friendly;
pub mod naive;
pub mod runner;
pub mod simd;
pub mod streaming;
pub mod threaded;

// Prose documentation. These modules contain no code; they exist only so that
// `cargo doc` renders the Markdown pages under `docs/` and `cargo test --doc`
// runs the examples in them.
#[cfg(any(doc, doctest))]
pub mod design;
#[cfg(any(doc, doctest))]
pub mod guide;

pub use error::{DimensionMismatch, MatmulError};
pub use matrix::Matrix;
