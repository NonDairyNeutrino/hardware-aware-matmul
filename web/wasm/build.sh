#!/usr/bin/env bash
# Builds the wasm module with threads (pinned nightly via rust-toolchain.toml)
# and generates the JavaScript glue into pkg/.
# This is the THREADED build. The stable, single-threaded build is build-lite.sh.
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features. Unset: no-bundler, for pages that load the
#                    module without a bundler (the gates). `FEATURES=threads` is
#                    the bundler build used by the Astro site. The choice is
#                    recorded in pkg/.features.
set -euo pipefail
cd "$(dirname "$0")"
WASM_BINDGEN=${WASM_BINDGEN:-wasm-bindgen}
FEATURES=${FEATURES-no-bundler}
case "$FEATURES" in
  threads|no-bundler) ;;
  *) echo "FEATURES must be 'threads' or 'no-bundler' (got '$FEATURES'); the stable build is build-lite.sh" >&2; exit 2 ;;
esac
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}

# Atomics, shared memory and the TLS exports that wasm-bindgen-rayon needs, and 128-bit
# SIMD (every current browser has it), which lets the level 3 micro-kernel be
# auto-vectorised to wasm vector instructions. They live here, not in
# .cargo/config.toml, so native `cargo test` never sees them. RUSTFLAGS replaces any
# other rustflags.
RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+simd128"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--import-memory"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size"
RUSTFLAGS="$RUSTFLAGS -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base"
export RUSTFLAGS

cargo build --release --target wasm32-unknown-unknown \
  --features "$FEATURES" -Z build-std=panic_abort,std
rm -rf pkg
"$WASM_BINDGEN" --target web --out-dir pkg \
  "$TARGET_DIR/wasm32-unknown-unknown/release/hardware_aware_matmul_web.wasm"
# A bundler resolves the bare directory import in wasm-bindgen-rayon's worker
# helper through package.json; the raw CLI does not write one (wasm-pack does).
cat > pkg/package.json <<'JSON'
{
  "name": "hardware_aware_matmul_web",
  "type": "module",
  "main": "hardware_aware_matmul_web.js",
  "module": "hardware_aware_matmul_web.js"
}
JSON
printf '%s' "$FEATURES" > pkg/.features
