#!/usr/bin/env bash
# Gate G3: the wasm module from an Astro production build, served under
# /matmul_levels.rs/ WITHOUT cross-origin-isolation headers (as GitHub Pages
# would), made isolated by coi-serviceworker, run in headless Firefox. The page is
# /matmul_levels.rs/gate/; the service worker is registered from the site root so
# its scope covers /_astro/ (the worker and wasm). Passes only if all 29 cases hash
# exactly like native Rust, the page reloaded, and the scope is /matmul_levels.rs/.
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
else
  (cd "$WASM" && FEATURES=threads ./build.sh)
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
export NO_ISOLATION=1 REPORT="$WASM/target/g3-report.json" LOG="$WASM/target/g3-server.log"
rm -f "$LOG"
../dev/run_page.sh "$ROOT" "matmul_levels.rs/gate/?gate=g2" "${TIMEOUT:-180}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I ../dev/check_report.py g3 "$REPORT"
