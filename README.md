# hardware_aware_matmul

Dense matrix multiplication in Rust, presented as **six implementations of
increasing performance**, each a small step beyond the one before, so the fast
version is understood in stages rather than met as one big blob.

Read it as a paper, and run the benchmark in your browser, at
<https://www.natchap.me/hardware-aware-matmul/>.

| Level | Module             | Adds                                       | Fixes               |
|-------|--------------------|--------------------------------------------|---------------------|
| 0     | `naive`            | The textbook triple loop                   | (the reference)     |
| 1     | `threaded`         | Output rows split across scoped threads    | Idle cores          |
| 2     | `cache_friendly`   | `i-k-j` loop order and cache blocking      | Waiting on memory   |
| 3     | `simd`             | Register-blocked, vectorisable micro-kernel | The load/store bottleneck |
| 4     | `packed`           | Each cache block of `B` copied to contiguous strips first | Strided reads of `B` |
| 5     | `streaming`        | Tiles, sources and sinks, a work queue     | The memory limit    |

Every level returns **exactly the same result, bit for bit**: each output
element is summed in increasing `k` order starting from zero at every level.
The levels differ in *how* the work is done, never in *what* is computed.

Level 5 can multiply matrices that **never fit in memory**: it computes one
output tile at a time, streaming the matching input tiles past a running
accumulator. Peak buffer memory depends on the tile shape and thread count, not
on the matrix size. It is not faster than level 3 or 4 on data that fits in RAM; it
is what makes data that does not fit possible.

The SIMD level gets its vector instructions from the compiler's
auto-vectoriser, not from intrinsics, so the crate stays free of `unsafe` and of
dependencies.

## Quick start

```rust
use std::num::NonZeroUsize;
use hardware_aware_matmul::{cache_friendly, naive, packed, simd, streaming, threaded, Matrix};

let a = Matrix::new(2, 3, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
let b = Matrix::new(3, 2, vec![7.0, 8.0, 9.0, 10.0, 11.0, 12.0]);
let threads = NonZeroUsize::new(2).unwrap();

let c0 = naive::matmul(&a, &b)?;
let c1 = threaded::matmul(&a, &b, threads)?;
let c2 = cache_friendly::matmul(&a, &b, threads)?;
let c3 = simd::matmul(&a, &b, threads)?;
let c4 = packed::matmul(&a, &b, threads)?;
let c5 = streaming::matmul(&a, &b, threads)?;
assert!(c0 == c1 && c1 == c2 && c2 == c3 && c3 == c4 && c4 == c5);
# Ok::<(), Box<dyn std::error::Error>>(())
```

Multiplying matrices stored on disk (level 5):

```rust
use std::num::NonZeroUsize;
use hardware_aware_matmul::streaming::{matmul_streaming, FileMatrix, StreamConfig};

let n = 4096;
let a = FileMatrix::create("a.bin", n, n)?;
a.fill_with(|i, j| (i + j) as f64)?;
let b = FileMatrix::create("b.bin", n, n)?;
b.fill_with(|i, j| (i * j) as f64)?;
let c = FileMatrix::create("c.bin", n, n)?;

let config = StreamConfig::new(NonZeroUsize::new(8).unwrap())
    .with_tile_shape(512, 512, 512);
println!("tile buffers: at most {} bytes", config.peak_buffer_bytes());
matmul_streaming(&a, &b, &c, &config)?;
# Ok::<(), Box<dyn std::error::Error>>(())
```

## See the progression

```sh
cargo run --release                    # times all six levels on one problem
cargo run --release -- 1024 8          # n = 1024, 8 threads
cargo run --release --bin out_of_core  # level 5 on matrices stored in files

# let the SIMD level use every vector instruction your CPU has:
RUSTFLAGS="-C target-cpu=native" cargo run --release
```

`compare` multiplies two `n × n` matrices at every level, verifies that the
five results are identical, and prints each level's time relative to the
previous level and to the naive baseline. The documentation contains no
benchmark numbers: measure on your own hardware, and always use `--release`. (The
project's website publishes one reference run, as generated data, with the machine it
was taken on.)

## Documentation

The documentation comes in three forms:

- **The website**, <https://www.natchap.me/hardware-aware-matmul/>: the levels as a
  paper (abstract, introduction, one chapter per level, results, discussion,
  conclusion), a generated results page from one reference benchmark run, and a
  playground that runs the benchmark on your own machine in the browser.
- **Rustdoc**, built by Cargo from the source and the Markdown pages under `docs/`:

  ```sh
  cargo doc --open     # API reference plus the story, guide, and design pages
  cargo test --doc     # compile and run every example in the documentation
  ```

- **Animations** in `anim/`: one Manim scene per level, which the site embeds.

The six implementation modules are the story: read the documentation of
`naive`, then `threaded`, then `cache_friendly`, then `simd`, then `packed`, then `streaming`,
in that order. Each chapter says what changed from the previous level, why it helps,
and what it costs. Two further modules hold the other pages:

| Module                    | Contents                                                              |
|---------------------------|-----------------------------------------------------------------------|
| `hardware_aware_matmul::guide`     | Getting started, and using the levels on in-memory matrices            |
| `hardware_aware_matmul::design`    | How the levels build on each other, and `Runner`, the job executor    |

The Markdown sources are readable on their own; start at
[`docs/introduction.md`](docs/introduction.md).

## Building, testing, running

```sh
cargo test    # unit, integration, and doc tests
```

Requires Rust 1.73 or newer. Disk-backed matrices are available on Unix and
Windows. The library also compiles for `wasm32-unknown-unknown`, which is how the
website runs it.

To work on the tests, the website or the animations, or to re-run the reference
benchmark, see [`CONTRIBUTING.md`](CONTRIBUTING.md). The website's internals are
described in [`web/README.md`](web/README.md).

## Repository layout

```text
src/
├── lib.rs               crate root; its docs are docs/introduction.md
├── matrix.rs            Matrix, shared by every level
├── error.rs             MatmulError, DimensionMismatch, the shared shape check
├── naive.rs             level 0
├── threaded.rs          level 1 (also the row-block driver levels 2 to 4 reuse)
├── runner.rs            Runner trait and StdRunner: where levels 1 to 5 run their jobs
├── cache_friendly.rs    level 2 (also home of axpy and the cache-block sizes)
├── simd.rs              level 3 (the register-blocked micro-kernel)
├── packed.rs            level 4 (packs B into contiguous strips for the level-3 kernel)
├── streaming/           level 5
│   ├── mod.rs
│   ├── tile.rs          TileSource / TileSink traits, MemorySink
│   ├── file.rs          FileMatrix (disk-backed source and sink)
│   ├── multiply.rs      matmul_streaming, StreamConfig, matmul
│   └── kernel.rs        accumulate_tile (private)
├── guide.rs, guide/     include the guide pages (docs/doctests only)
├── design.rs, design/   include the design pages (docs/doctests only)
└── bin/
    ├── compare.rs       times all six levels
    └── out_of_core.rs   level 5 on files
examples/
├── hw_probe.rs          memory bandwidth and arithmetic peak, for the results page
└── level_once.rs        one level on one problem, for counting hardware events (web/dev/perf_counters.py)
docs/
├── introduction.md      the crate's rustdoc front page
├── levels/              naive, threaded, cache_friendly, simd, packed, streaming
├── guide/               getting_started, in_memory
├── design/              architecture, runner
├── paper/               the website's own pages (not in rustdoc)
└── superpowers/         website specs and plans (not product documentation)
tests/
├── levels.rs            all six levels agree, exactly
└── streaming.rs         level 5: tile shapes, errors, files
anim/                    Manim scenes, one per level
web/
├── wasm/                the levels as WebAssembly (separate crate)
├── dev/                 dev server, benchmark reference run, results assembler
└── site/                the Astro website
```

## License

The code, and the documentation compiled into the crate, are licensed under either of

- the Apache License, Version 2.0 ([`LICENSE-APACHE`](LICENSE-APACHE)), or
- the MIT license ([`LICENSE-MIT`](LICENSE-MIT)),

at your option. Unless you state otherwise, any contribution you submit for inclusion is
dual-licensed in the same way, without further terms.

The paper's prose (`docs/paper/`) and the rendered animation videos
(`anim/media/videos/`) are licensed under the Creative Commons Attribution 4.0
International license ([`LICENSE-CC-BY-4.0`](LICENSE-CC-BY-4.0)). The animation scene
sources (`anim/*.py`) are code, under the dual license above.

The website bundles `coi-serviceworker` (MIT, Guido Zuidhof and contributors), whose
notice stays in the file, and the compiled WebAssembly includes the Rust standard
library and the crates listed in `web/wasm/Cargo.lock`, which are MIT and/or
Apache-2.0 licensed.
