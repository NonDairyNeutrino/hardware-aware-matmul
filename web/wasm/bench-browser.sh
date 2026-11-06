#!/usr/bin/env bash
# Runs the benchmark matrix in headless Firefox for one build and writes the page's JSON
# report to OUT. Part of the reference run (web/dev/bench-reference.sh).
# usage: bench-browser.sh lite|threads OUT.json
#   lite     the stable single-threaded build (pkg-lite/)
#   threads  the threaded build (pkg/, built with the no-bundler feature), with a pool of
#            min(cores, 8) threads
# Both are served WITH the isolation headers: the lite build does not need them, but an
# isolated page gets Firefox's fine-grained timer (a non-isolated page's performance.now()
# is rounded to about a millisecond, too coarse for the fastest cases).
# env: SIZES (default "512 1024"), THREADS (default "1 2 4 8"; the lite build always uses
#      "1"), REPEATS (5), WARMUP (1), PORT (8765), TIMEOUT seconds (default 3600)
# Exits non-zero unless the page reports ok.
set -euo pipefail
cd "$(dirname "$0")"
BUILD=${1:?usage: bench-browser.sh lite|threads OUT.json}
OUT=${2:?usage: bench-browser.sh lite|threads OUT.json}
case "$BUILD" in
  lite) PKG=pkg-lite; THREADS_LIST=1 ;;
  threads) PKG=pkg; THREADS_LIST=$(echo "${THREADS:-1 2 4 8}" | tr ' ' ',') ;;
  *) echo "unknown build: $BUILD" >&2; exit 2 ;;
esac
if [ ! -f "$PKG/hardware_aware_matmul_web_bg.wasm" ]; then
  echo "REFUSING: $PKG/ is missing; build it first (./build-lite.sh or ./build.sh)"; exit 1
fi
if [ "$PKG" = pkg ] && [ "$(cat pkg/.features 2>/dev/null || echo unknown)" != "no-bundler" ]; then
  echo "REFUSING: pkg/ was not built with the no-bundler feature; run ./build.sh"; exit 1
fi
SIZES_LIST=$(echo "${SIZES:-512 1024}" | tr ' ' ',')
mkdir -p target
export REPORT="$PWD/target/bench-$BUILD-report.json" LOG="$PWD/target/bench-$BUILD-server.log"
rm -f "$LOG"
URL="www/bench.html?build=$BUILD&sizes=$SIZES_LIST&threads=$THREADS_LIST&repeats=${REPEATS:-5}&warmup=${WARMUP:-1}"
../dev/run_page.sh . "$URL" "${TIMEOUT:-3600}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I - "$REPORT" "$OUT" <<'PYEOF'
import json, shutil, sys
report = json.load(open(sys.argv[1]))
if not report.get("ok"):
    print("FAIL: the bench page reported an error:", report.get("error"))
    sys.exit(1)
shutil.copy(sys.argv[1], sys.argv[2])
print("bench-browser: %s: %d runs -> %s" % (report["kind"], len(report["runs"]), sys.argv[2]))
PYEOF
