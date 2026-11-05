#!/usr/bin/env bash
# Builds the wasm module with threads (pinned nightly via rust-toolchain.toml)
# and generates the JavaScript glue into pkg/.
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features (default: no-bundler)
set -euo pipefail
cd "$(dirname "$0")"
WASM_BINDGEN=${WASM_BINDGEN:-wasm-bindgen}
FEATURES=${FEATURES:-no-bundler}
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}
cargo build --release --target wasm32-unknown-unknown \
  --features "$FEATURES" -Z build-std=panic_abort,std
rm -rf pkg
"$WASM_BINDGEN" --target web --out-dir pkg \
  "$TARGET_DIR/wasm32-unknown-unknown/release/naive_matmul_web.wasm"
