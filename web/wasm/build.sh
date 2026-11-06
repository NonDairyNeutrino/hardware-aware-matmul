#!/usr/bin/env bash
# Builds the wasm module with threads (pinned nightly via rust-toolchain.toml)
# and generates the JavaScript glue into pkg/.
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH)
#      CARGO_TARGET_DIR  honoured (default: ./target)
#      FEATURES      cargo features. Unset: no-bundler, for pages that load the
#                    module without a bundler (the gates). Set to the empty
#                    string (FEATURES= ./build.sh) for the bundler build used by
#                    the Astro site. The choice is recorded in pkg/.features.
set -euo pipefail
cd "$(dirname "$0")"
WASM_BINDGEN=${WASM_BINDGEN:-wasm-bindgen}
FEATURES=${FEATURES-no-bundler}
TARGET_DIR=${CARGO_TARGET_DIR:-$PWD/target}
cargo build --release --target wasm32-unknown-unknown \
  --features "$FEATURES" -Z build-std=panic_abort,std
rm -rf pkg
"$WASM_BINDGEN" --target web --out-dir pkg \
  "$TARGET_DIR/wasm32-unknown-unknown/release/naive_matmul_web.wasm"
# A bundler resolves the bare directory import in wasm-bindgen-rayon's worker
# helper through package.json; the raw CLI does not write one (wasm-pack does).
cat > pkg/package.json <<'JSON'
{
  "name": "naive_matmul_web",
  "type": "module",
  "main": "naive_matmul_web.js",
  "module": "naive_matmul_web.js"
}
JSON
printf '%s' "$FEATURES" > pkg/.features
