#!/usr/bin/env bash
# Builds the STABLE, single-threaded wasm module into pkg-lite/: no threads, no
# atomics, no nightly. Used by the chapters and as the playground's fallback. The
# threaded build is build.sh.
# env: WASM_BINDGEN  path to the wasm-bindgen CLI (default: wasm-bindgen on PATH, else
#                    ~/.cargo/bin/wasm-bindgen)
#      CARGO_TARGET_DIR  honoured; this build uses "<dir>-lite" (default ./target-lite)
set -euo pipefail
cd "$(dirname "$0")"
# Unset: wasm-bindgen on PATH, else the copy `cargo install` puts in ~/.cargo/bin.
if [ -z "${WASM_BINDGEN:-}" ]; then
  if command -v wasm-bindgen >/dev/null; then WASM_BINDGEN=wasm-bindgen; else WASM_BINDGEN=$HOME/.cargo/bin/wasm-bindgen; fi
fi
TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}-lite"
# `+stable` overrides the nightly pinned for this directory by rust-toolchain.toml.
# 128-bit SIMD (every current browser has it) lets the level 3 micro-kernel be
# auto-vectorised to wasm vector instructions. RUSTFLAGS replaces any other rustflags.
RUSTFLAGS="-C target-feature=+simd128" \
  cargo +stable build --release --target wasm32-unknown-unknown --target-dir "$TARGET_DIR"
rm -rf pkg-lite
"$WASM_BINDGEN" --target web --out-dir pkg-lite \
  "$TARGET_DIR/wasm32-unknown-unknown/release/hardware_aware_matmul_web.wasm"
cat > pkg-lite/package.json <<'JSON'
{
  "name": "hardware_aware_matmul_web",
  "type": "module",
  "main": "hardware_aware_matmul_web.js",
  "module": "hardware_aware_matmul_web.js"
}
JSON
