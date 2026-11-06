#!/usr/bin/env bash
# Runs one browser gate headlessly and exits non-zero unless it passes.
# usage: gate.sh g1|g2|probe|g5 [--no-build]
#   g1     the thread pool starts and runs a parallel sum
#   g2     29 cases (levels 0 to 4) must hash exactly like native Rust
#   probe  informational: records whether StdRunner works in the browser (it traps)
#   g5     informational: records limits (pool start-up, re-init, panic, memory)
# The Astro-build gate (g3) is web/site/gate-g3.sh.
# env: WASM_BINDGEN (path to the CLI), PORT (default 8765), TIMEOUT (seconds)
# --no-build reuses pkg/, but refuses if pkg/ is missing, was built for the
# bundler, or is older than the sources.
set -euo pipefail
cd "$(dirname "$0")"
GATE=${1:?usage: gate.sh g1|g2|probe|g5 [--no-build]}
case "$GATE" in
  g1|g2|probe) URL="www/gate.html?gate=$GATE" ;;
  g5) URL="www/limits.html" ;;
  *) echo "unknown gate: $GATE" >&2; exit 2 ;;
esac

if [ "${2:-}" = "--no-build" ]; then
  WASM=pkg/naive_matmul_web_bg.wasm
  if [ ! -f "$WASM" ]; then
    echo "REFUSING: $WASM is missing; run ./build.sh (or drop --no-build)"; exit 1
  fi
  if [ "$(cat pkg/.features 2>/dev/null || echo unknown)" != "no-bundler" ]; then
    echo "REFUSING: pkg/ was not built with the no-bundler feature; run ./build.sh (or drop --no-build)"; exit 1
  fi
  NEWER=$(find src examples Cargo.toml ../../src ../../Cargo.toml -name '*.rs' -newer "$WASM" -print -quit -o -name Cargo.toml -newer "$WASM" -print -quit)
  if [ -n "$NEWER" ]; then
    echo "REFUSING: $NEWER is newer than $WASM; run ./build.sh (or drop --no-build)"; exit 1
  fi
else
  ./build.sh
fi

mkdir -p target
if ! cargo run --release --example expected 2> target/expected-build.log > www/expected.json; then
  cat target/expected-build.log
  echo "FAIL: could not generate the expected hashes"
  exit 1
fi
export REPORT="$PWD/target/$GATE-report.json" LOG="$PWD/target/$GATE-server.log"
rm -f "$LOG"
../dev/run_page.sh . "$URL" "${TIMEOUT:-180}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I ../dev/check_report.py "$GATE" "$REPORT"
