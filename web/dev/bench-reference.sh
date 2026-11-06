#!/usr/bin/env bash
# The reference run: times every level natively and in headless Firefox (the lite and the
# threaded wasm builds), and writes web/site/src/data/results.json, the data the Results
# section cites. Run it by hand on an otherwise IDLE machine (shared CI machines are too
# noisy to time anything), then commit the file with a message saying why it was re-run.
#
# usage: web/dev/bench-reference.sh
# env (defaults are the full reference run):
#   SIZES="512 1024"   THREADS="1 2 4 8"   REPEATS=9   WARMUP=2   PORT=8765
#   OUT=web/site/src/data/results.json     WASM_BINDGEN=$HOME/.cargo/bin/wasm-bindgen
# It refuses to run when the 1-minute load average is above 1.0 (set ALLOW_BUSY=1 to
# override) or when tracked files have uncommitted changes (ALLOW_DIRTY=1 to override), so
# the recorded numbers come from an idle machine and a commit that can be checked out.
# Smaller values are for rehearsing the pipeline, e.g.
#   SIZES="64 128" THREADS="1 2" REPEATS=2 ALLOW_BUSY=1 OUT=/tmp/rehearsal.json web/dev/bench-reference.sh
# Thread counts above the machine's cores are dropped (natively) or above the pool size
# (in the browser). The file is only written if every run, native and browser, produced
# the same result hash for each size (web/dev/results.py).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
export SIZES=${SIZES:-"512 1024"} THREADS=${THREADS:-"1 2 4 8"} REPEATS=${REPEATS:-9} WARMUP=${WARMUP:-2}
export PORT=${PORT:-8765}
OUT=${OUT:-$ROOT/web/site/src/data/results.json}

if ss -ltnp 2>/dev/null | grep -q ":$PORT "; then
  echo "REFUSING: something already listens on port $PORT (a stray server makes the browser runs fail)"; exit 1
fi
if [ "${ALLOW_DIRTY:-0}" != 1 ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "REFUSING: tracked files have uncommitted changes (commit them, or set ALLOW_DIRTY=1)"; exit 1
fi
LOAD=$(cut -d' ' -f1 /proc/loadavg)
echo "load average: $(cut -d' ' -f1-3 /proc/loadavg) (the machine should be idle)"
if [ "${ALLOW_BUSY:-0}" != 1 ] && awk -v l="$LOAD" 'BEGIN { exit !(l > 1.0) }'; then
  echo "REFUSING: the 1-minute load average is $LOAD (above 1.0); wait for the machine to go idle, or set ALLOW_BUSY=1"; exit 1
fi
export BENCH_LOAD_START=$LOAD
WORK=$ROOT/web/wasm/target/bench
mkdir -p "$WORK" "$(dirname "$OUT")"

echo "== building the wasm modules"
(cd web/wasm && ./build-lite.sh && ./build.sh)

echo "== native"
(cd web/wasm && cargo run --release --example bench -- \
  --sizes "${SIZES// /,}" --threads "${THREADS// /,}" --repeats "$REPEATS" --warmup "$WARMUP") > "$WORK/native.json"

echo "== browser, lite build"
web/wasm/bench-browser.sh lite "$WORK/lite.json"
echo "== browser, threaded build"
web/wasm/bench-browser.sh threads "$WORK/threads.json"

echo "== assembling"
python3 -I web/dev/results.py --native "$WORK/native.json" --lite "$WORK/lite.json" \
  --threads "$WORK/threads.json" --out "$OUT"
