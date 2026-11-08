#!/usr/bin/env bash
# Gate G3: the wasm module from an Astro production build, served under
# /hardware-aware-matmul/ WITHOUT cross-origin-isolation headers (as GitHub Pages
# would), made isolated by coi-serviceworker, run in headless Firefox. The page is
# /hardware-aware-matmul/gate/ (built only in this GATE=1 build); it registers the gate-only
# root copy of the service worker, whose scope covers /gate/ and the worker under
# /playground/_worker/. (The playground registers its own copy, scoped to /playground/.) Passes only if all 36 cases hash
# exactly like native Rust, the page reloaded, and the scope is /hardware-aware-matmul/.
# The site build also needs the lite module (the step-through), so both are built.
# usage: gate-g3.sh [--no-build]
# env: WASM_BINDGEN, NODE_IMAGE (default node:latest), PORT, TIMEOUT (seconds)
set -euo pipefail
cd "$(dirname "$0")"
SITE=$PWD
WASM=$SITE/../wasm

if [ "${1:-}" = "--no-build" ]; then
  if [ "$(cat "$WASM/pkg/.features" 2>/dev/null || echo unknown)" != "threads" ]; then
    echo "REFUSING: pkg/ was not built for the bundler; run ./gate-g3.sh without --no-build"; exit 1
  fi
  if [ ! -f "$WASM/pkg-lite/hardware_aware_matmul_web.js" ]; then
    echo "REFUSING: pkg-lite/ is missing; run ./gate-g3.sh without --no-build"; exit 1
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
export GATE=1 # build the test pages under /gate/ too, and have check-dist expect them
../dev/node.sh site npm run build
../dev/node.sh site npm run check

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
ln -s "$SITE/dist" "$ROOT/hardware-aware-matmul"
export NO_ISOLATION=1 REPORT="$WASM/target/g3-report.json" LOG="$WASM/target/g3-server.log"
rm -f "$LOG"
../dev/run_page.sh "$ROOT" "hardware-aware-matmul/gate/?gate=g2" "${TIMEOUT:-180}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I ../dev/check_report.py g3 "$REPORT"
