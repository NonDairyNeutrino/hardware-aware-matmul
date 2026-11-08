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
# SIZES defaults to "512 1024" and the largest size is the paper's default, so every
# {{...}} default of the paper follows it. The owner may add 256 and 2048 (SIZES="256 512
# 1024 2048"); adding or dropping a size changes every {{...}} default of the paper.
# After the native run it also runs examples/hw_probe.rs (memory bandwidth and peak
# arithmetic per thread count, with the machine's cache sizes recorded by results.py), so
# the Discussion can test its cache and bandwidth explanations against the machine.
# It then counts cache and TLB misses per level with web/dev/perf_counters.py (one thread, at
# 1024 and at the largest size, see COUNTERS_SIZES) so the Discussion can test whether a level is faster because it misses
# less. That step needs `perf` and perf_event_paranoid <= 2; without them it is skipped, and
# results.json simply has no `environment.counters` (set REQUIRE_COUNTERS=1 to refuse that).
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

echo "== hardware probe (bandwidth and peak arithmetic)"
# Thread counts above the machine's logical cores are dropped, as in the native run.
CORES=$(nproc)
PROBE_THREADS=""
for t in $THREADS; do [ "$t" -le "$CORES" ] && PROBE_THREADS="${PROBE_THREADS:+$PROBE_THREADS,}$t"; done
cargo run --release --example hw_probe -- --threads "$PROBE_THREADS" > "$WORK/hw_probe.json"

echo "== hardware event counts (perf stat)"
# At 1024 if it is one of the sizes (the three matrices then outgrow the L3 cache, and level 0 still
# finishes in seconds) and at the largest size, where the levels differ most (level 0 takes about
# a minute there per multiplication, so that count is one multiplication per process and takes a
# long time). COUNTERS_SIZES overrides the list.
LARGEST=$(printf '%s\n' $SIZES | sort -n | tail -1)
DEFAULT_COUNTERS_SIZES=$( { printf '%s\n' $SIZES | grep -x 1024; echo "$LARGEST"; } | sort -nu | tr '\n' ' ')
COUNTERS_SIZES=${COUNTERS_SIZES:-$DEFAULT_COUNTERS_SIZES}
COUNTERS_ARGS=()
# Build with the toolchain the timed native runs use (web/wasm pins one), not the default.
COUNTERS_TOOLCHAIN=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' web/wasm/rust-toolchain.toml)
COUNTERS_FILES=()
COUNTERS_FAILED=0
for COUNTERS_N in $COUNTERS_SIZES; do
  # One multiplication per process at the sizes where level 0 is slow, three otherwise.
  if [ "$COUNTERS_N" -ge 2048 ]; then COUNTERS_REPS=1; else COUNTERS_REPS=3; fi
  if python3 -I web/dev/perf_counters.py --n "$COUNTERS_N" --threads 1 --reps "$COUNTERS_REPS" \
       ${COUNTERS_TOOLCHAIN:+--toolchain "$COUNTERS_TOOLCHAIN"} --out "$WORK/counters-$COUNTERS_N.json"; then
    COUNTERS_FILES+=("$WORK/counters-$COUNTERS_N.json")
  else
    COUNTERS_FAILED=1
  fi
done
if [ "$COUNTERS_FAILED" = 0 ]; then
  COUNTERS_ARGS=(--counters "${COUNTERS_FILES[@]}")
elif [ "${REQUIRE_COUNTERS:-0}" = 1 ]; then
  echo "REFUSING: the event counts failed and REQUIRE_COUNTERS=1"; exit 1
else
  echo "skipping the event counts (see the message above); results.json will have no environment.counters"
fi

echo "== browser, lite build"
web/wasm/bench-browser.sh lite "$WORK/lite.json"
echo "== browser, threaded build"
web/wasm/bench-browser.sh threads "$WORK/threads.json"

echo "== assembling"
python3 -I web/dev/results.py --native "$WORK/native.json" --lite "$WORK/lite.json" \
  --threads "$WORK/threads.json" --probe "$WORK/hw_probe.json" ${COUNTERS_ARGS[@]+"${COUNTERS_ARGS[@]}"} --out "$OUT"
