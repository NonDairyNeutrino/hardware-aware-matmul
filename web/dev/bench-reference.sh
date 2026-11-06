#!/usr/bin/env bash
# The reference run: times every level natively and in headless Firefox (the lite and the
# threaded wasm builds), and writes web/site/src/data/results.json, the data the Results
# section cites. Run it by hand on an otherwise IDLE machine (shared CI machines are too
# noisy to time anything), then commit the file with a message saying why it was re-run.
#
# usage: web/dev/bench-reference.sh
# env (defaults are the full reference run):
#   SIZES="512 1024"   THREADS="1 2 4 8"   REPEATS=5   WARMUP=1
#   OUT=web/site/src/data/results.json     WASM_BINDGEN=$HOME/.cargo/bin/wasm-bindgen
# Smaller values are for rehearsing the pipeline, e.g.
#   SIZES="64 128" THREADS="1 2" REPEATS=2 OUT=/tmp/rehearsal.json web/dev/bench-reference.sh
# Thread counts above the machine's cores are dropped (natively) or above the pool size
# (in the browser). The file is only written if every run, native and browser, produced
# the same result hash for each size (web/dev/results.py).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
export SIZES=${SIZES:-"512 1024"} THREADS=${THREADS:-"1 2 4 8"} REPEATS=${REPEATS:-5} WARMUP=${WARMUP:-1}
OUT=${OUT:-$ROOT/web/site/src/data/results.json}

if ss -ltnp 2>/dev/null | grep -q ':8765 '; then
  echo "REFUSING: something already listens on port 8765 (a stray server makes the browser runs fail)"; exit 1
fi
echo "load average: $(cut -d' ' -f1-3 /proc/loadavg) (the machine should be idle)"
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
