#!/usr/bin/env bash
# Gate C3: the playground page of the Astro production build, served under
# /hardware-aware-matmul/ WITHOUT cross-origin-isolation headers (as GitHub Pages would), in
# headless Firefox. Five scenarios, each a fresh browser profile:
#   threads  the page enables isolation through the service worker (one reload), uses the
#            threaded build and every level gives the native answer
#   lite     service workers disabled: the page falls back to the single-threaded build,
#            locks the threads control, shows the banner, and still gives the native answer
#   recover  a run is cancelled, another times out, and a third still completes correctly
#   fallback the threaded worker fails to start (the page is told to load a missing one): the
#            run moves to the lite build by itself, with a note, and gives the native answer
#   migrate  a returning visitor of an earlier version: /gate/migrate/ registers the real service
#            worker at the site root first (gate builds only have it there), then opens the
#            playground, which must reload once to leave it, register its own, run threaded, and
#            leave no registration that covers a paper page
# usage: gate-c3.sh [--no-build]
# env: WASM_BINDGEN, NODE_IMAGE (default node:latest), PORT, TIMEOUT (seconds per scenario)
set -euo pipefail
cd "$(dirname "$0")"
SITE=$PWD
WASM=$SITE/../wasm

if ss -ltn | grep -q ':8765 '; then
  echo "REFUSED: port 8765 is busy" >&2; exit 1
fi

if [ "${1:-}" = "--no-build" ]; then
  if [ "$(cat "$WASM/pkg/.features" 2>/dev/null || echo unknown)" != "threads" ]; then
    echo "REFUSING: pkg/ was not built for the bundler; run ./gate-c3.sh without --no-build"; exit 1
  fi
  if [ ! -f "$WASM/pkg-lite/hardware_aware_matmul_web.js" ]; then
    echo "REFUSING: pkg-lite/ is missing; run ./gate-c3.sh without --no-build"; exit 1
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
export NO_ISOLATION=1
for SCENARIO in threads lite recover fallback migrate; do
  echo "== playground, scenario $SCENARIO"
  export REPORT="$WASM/target/c3-$SCENARIO-report.json" LOG="$WASM/target/c3-$SCENARIO-server.log"
  rm -f "$LOG"
  PREFS=""
  if [ "$SCENARIO" = lite ]; then PREFS='user_pref("dom.serviceWorkers.enabled", false);'; fi
  URLPATH="hardware-aware-matmul/playground/?gate=$SCENARIO"
  if [ "$SCENARIO" = migrate ]; then URLPATH="hardware-aware-matmul/gate/migrate/"; fi
  FIREFOX_PREFS="$PREFS" ../dev/run_page.sh "$ROOT" "$URLPATH" "${TIMEOUT:-240}" \
    || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
  python3 -I ../dev/check_report.py "playground-$SCENARIO" "$REPORT"
done
echo "GATE C3: ALL SCENARIOS PASS"
