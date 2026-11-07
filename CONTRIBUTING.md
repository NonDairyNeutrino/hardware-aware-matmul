# Contributing

This file is the process: how to build, test, benchmark and deploy. For what the
project is, read [`README.md`](README.md). For the website's internals, read
[`web/README.md`](web/README.md).

## Ground rules

- **Every level returns the same bits.** Each output element is summed in increasing
  `k` order starting from zero. An optimisation may reorder loops, block, or
  vectorise, but it must not reassociate the sum, change fused-multiply-add use,
  or split accumulators over `k`. `tests/levels.rs` compares the raw bits
  (`to_bits`) of all six levels and will fail if you break this.
- **The core crate stays dependency-free**, `#![forbid(unsafe_code)]`, and builds
  on Rust 1.73. Nightly and wasm dependencies live only in `web/wasm`.
- **Prose lives in Markdown, not in `.rs` files.** Module docs are
  `include_str!`'d from `docs/`, and their code blocks are doctests.
- **No benchmark numbers by hand.** Numbers appear only as generated data
  (see [The reference run](#the-reference-run)).
- The code is MIT OR Apache-2.0 and the paper prose and videos are CC BY 4.0 (see
  [License](README.md#license)); contributions are accepted under the same terms. Keep
  dependencies of the core crate at zero, and check the license of anything added to
  `web/wasm` or `web/site` (the site's output must stay permissively licensed).
- The trunk branch is `trunk`. Keep commits small, one idea each, with a short
  one-line message.

## The crate

```sh
cargo build
cargo test                       # unit + integration + doc tests
cargo test --test levels         # one integration file (tests/levels.rs or tests/streaming.rs)
cargo test <name>                # one test, by name substring
cargo doc --open                 # the rustdoc pages
cargo test --doc                 # only the examples in the documentation
```

Always benchmark with `--release`:

```sh
cargo run --release                      # the `compare` binary: times every level; args: [n] [threads]
cargo run --release -- 1024 8
cargo run --release --bin out_of_core    # level 5 on file-backed matrices
RUSTFLAGS="-C target-cpu=native" cargo run --release   # let level 3 use every CPU feature
python3 -I web/dev/perf_counters.py --n 1024 --threads 1   # cache/TLB misses per level (Linux, needs perf)
```

CI (`.github/workflows/rust.yml`) runs a build and the tests, a build on exactly
Rust 1.73 (the MSRV), and `cargo check --lib --target wasm32-unknown-unknown`.
You can reproduce the last two with `rustup toolchain install 1.73` and
`rustup target add wasm32-unknown-unknown`.

## The WebAssembly crate

`web/wasm` is a separate crate with its own `[workspace]`, so the core crate's
toolchain is unaffected. Its nightly is pinned in `web/wasm/rust-toolchain.toml`,
and the threaded build needs it. The "lite" build is stable and single-threaded.
Both enable `+simd128`.

```sh
cd web/wasm
cargo test                       # native tests of the case generator and plan JSON
cargo test --features threads    # plus the rayon tests
./build-lite.sh                  # stable, single-threaded build into pkg-lite/
FEATURES=threads ./build.sh      # threaded build into pkg/
```

The `wasm-bindgen` CLI version must equal the `=0.2.130` pin in
`web/wasm/Cargo.toml`. When `wasm-bindgen` is not on `PATH`, both build scripts
fall back to `~/.cargo/bin/wasm-bindgen`, or set `WASM_BINDGEN` yourself.
`WASM_BINDGEN_VERSION` in `.github/workflows/pages.yml` must track the same pin.

### Gates

A gate runs a scenario in headless Firefox and checks a report. Each builds
first. Pass `--no-build` to reuse the existing build.

```sh
cd web/wasm && ./gate.sh g1|g2|probe|g5|lite [--no-build]
cd web/site && ./gate-c2.sh [--no-build]   # the step-through element, with no isolation and no service worker
cd web/site && ./gate-c3.sh [--no-build]   # the playground, in five scenarios (see web/README.md)
cd web/site && ./gate-g3.sh [--no-build]   # Astro GATE=1 build served under /hardware-aware-matmul/ with no isolation headers
```

## The site

Node runs only in Docker, through `web/dev/node.sh` (image `node:latest`, or set
`NODE_IMAGE`). Run these from the repository root:

```sh
web/dev/node.sh site npm test          # unit tests: prose plugin, step-through model, results, playground
web/dev/node.sh site npm run build     # the site into web/site/dist
web/dev/node.sh site npm run check     # checks the built site (see web/README.md)
python3 -I web/dev/test_results.py     # unit tests of the results assembler
python3 -I web/dev/test_perf_counters.py  # unit tests of the hardware-counter script
```

`npm run build` needs `web/wasm/build-lite.sh` and `FEATURES=threads web/wasm/build.sh`
run first, and `web/site/public/expected.json` for the gate page. The gate scripts do
all three. The easiest local check is the one CI runs: see
`.github/workflows/pages.yml`.

### The reference run

`web/site/src/data/results.json` is the only source of benchmark numbers. Write
it with:

```sh
web/dev/bench-reference.sh
```

Run it by hand, on an otherwise idle machine, with the working tree clean (the
script refuses a busy machine or uncommitted changes; `ALLOW_BUSY=1` and
`ALLOW_DIRTY=1` override that for rehearsals only). It times every level natively
and in headless Firefox (lite and threaded), runs the hardware probe
(`cargo run --release --example hw_probe -- --threads 1,2,4,8`), and writes the
file only if every run produced the same result hash. Commit the file with a
message saying why it was re-run.

After a new run, `npm test` may fail in `web/site/src/results/claims.test.mjs`.
That test checks every ranking and margin the prose states in words against the
committed data. A failure means the run flipped the claim, so reword the prose
and the test. Never edit the data.

For a rehearsal that does not touch the real file:

```sh
SIZES="64 128" THREADS="1 2" REPEATS=2 ALLOW_BUSY=1 OUT=/tmp/rehearsal.json web/dev/bench-reference.sh
```

### Deployment

`.github/workflows/pages.yml` builds the site on manual dispatch, on every push
to `trunk` (which deploys it, unless the push only touches `docs/superpowers/`),
and on pull requests (build only). The owner sets Settings > Pages > Source =
GitHub Actions once.

## Animations

One Manim scene per level, in `anim/`:

| Level | File | Scene |
|-------|------|-------|
| 0 | `naive_matmul.py` | `NaiveMatMul` |
| 1 | `naive_matmul_parallel.py` | `ParallelNaiveMatMul` |
| 2 | `cache_friendly_matmul.py` | `CacheFriendlyMatMul` |
| 3 | `simd_matmul.py` | `SimdMatMul` |
| 4 | `streaming_matmul.py` | `StreamingMatMul` |

```sh
manim -ql anim/<file>.py <SceneClass>      # output lands in anim/media/
```

Without Manim and LaTeX installed, render in Docker:

```sh
docker run --rm -v "$PWD/anim:/manim" -w /manim manimcommunity/manim:latest \
  manim -ql --media_dir /manim/media <file>.py <SceneClass>
```

The level 2 to 5 scenes share `anim/common.py`. `naive_matmul_parallel_cache.py`
is an older combined scene that draws column-major memory, unlike the row-major
crate, so don't use it as a reference. The generated `Tex/`, `texts/` and
`partial_movie_files/` under `anim/media/` are untracked.

## Plans and specs

`docs/superpowers/` holds specs, plans and findings for the website work. It is
not product documentation and is excluded from the published package, so don't
glob `docs/**` when you mean the documentation.
