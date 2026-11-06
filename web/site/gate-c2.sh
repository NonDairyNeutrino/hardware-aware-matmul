#!/usr/bin/env bash
# Gate C2: the step-through element, from an Astro production build under
# /matmul_levels.rs/ on a page with NO isolation headers and NO service worker, in
# headless Firefox. The page at /gate/step-through/ mounts levels 1 to 4 on the lite
# wasm module, reports the plans and what was drawn; check_report.py compares them
# with what the core crate's own examples say they must be.
# usage: gate-c2.sh [--no-build]        env: WASM_BINDGEN, NODE_IMAGE, PORT, TIMEOUT
set -euo pipefail
cd "$(dirname "$0")"
SITE=$PWD
WASM=$SITE/../wasm

if [ "${1:-}" = "--no-build" ]; then
  if [ "$(cat "$WASM/pkg/.features" 2>/dev/null || echo unknown)" != "threads" ]; then
    echo "REFUSING: pkg/ was not built for the bundler; run ./gate-c2.sh without --no-build"; exit 1
  fi
  if [ ! -f "$WASM/pkg-lite/hardware_aware_matmul_web.js" ]; then
    echo "REFUSING: pkg-lite/ is missing; run ./gate-c2.sh without --no-build"; exit 1
  fi
else
  (cd "$WASM" && ./build-lite.sh && FEATURES=threads ./build.sh)
fi

mkdir -p "$WASM/target" "$SITE/public"
if ! (cd "$WASM" && cargo run --release --example expected 2> target/expected-build.log) > "$SITE/public/expected.json"; then
  cat "$WASM/target/expected-build.log"
  echo "FAIL: could not generate the expected hashes"
  exit 1
fi

[ -d node_modules ] || ../dev/node.sh site npm ci --no-audit --no-fund
../dev/node.sh site npm run build
../dev/node.sh site npm run check

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
ln -s "$SITE/dist" "$ROOT/matmul_levels.rs"
export NO_ISOLATION=1 REPORT="$WASM/target/c2-report.json" LOG="$WASM/target/c2-server.log"
rm -f "$LOG"
../dev/run_page.sh "$ROOT" "matmul_levels.rs/gate/step-through/" "${TIMEOUT:-120}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I ../dev/check_report.py stepthrough "$REPORT"
