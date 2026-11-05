#!/usr/bin/env bash
# Runs one browser gate headlessly and exits non-zero unless it passes.
# usage: gate.sh g1|g2|probe [--no-build]
# `--no-build` reuses pkg/, and refuses to run if pkg/ is missing or older than
# any source file (run ./build.sh first).
# `probe` is informational: it records whether the standard-library runner works
# in the browser (expected: it does not) and passes whenever the page ran.
# env: WASM_BINDGEN (path to the CLI), PORT (default 8765)
set -euo pipefail
cd "$(dirname "$0")"
GATE=${1:?usage: gate.sh g1|g2|probe [--no-build]}
if [ "${2:-}" = "--no-build" ]; then
  WASM=pkg/naive_matmul_web_bg.wasm
  if [ ! -f "$WASM" ]; then
    echo "REFUSING: $WASM is missing; run ./build.sh (or drop --no-build)" >&2
    exit 1
  fi
  NEWER=$(find src examples Cargo.toml ../../src ../../Cargo.toml \
    \( -name '*.rs' -o -name Cargo.toml \) -newer "$WASM" -print -quit)
  if [ -n "$NEWER" ]; then
    echo "REFUSING: $NEWER is newer than $WASM; run ./build.sh (or drop --no-build)" >&2
    exit 1
  fi
else
  ./build.sh
fi
mkdir -p target
if [ "$GATE" = g2 ]; then
  if ! cargo run --release --example expected 2>target/expected-build.log > www/expected.json; then
    echo "FAIL: could not generate www/expected.json:" >&2
    cat target/expected-build.log >&2
    exit 1
  fi
fi
export REPORT="$PWD/target/$GATE-report.json" LOG="$PWD/target/$GATE-server.log"
rm -f "$LOG"
./../dev/run_page.sh . "www/gate.html?gate=$GATE" "${TIMEOUT:-180}" || { echo "FAIL: the page never reported (see $LOG)"; exit 1; }
python3 -I - "$REPORT" "$GATE" <<'PYEOF'
import json, sys
report = json.load(open(sys.argv[1]))
gate = sys.argv[2]
print(json.dumps({k: v for k, v in report.items() if k != "cases"}, indent=2))
problems = []
if not report.get("ok"):
    problems.append("page reported an error: " + str(report.get("error")))
if not report.get("isolated"):
    problems.append("page is not cross-origin isolated")
if report.get("pool_threads") != 4:
    problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))
if gate == "probe":
    print("StdRunner works in the browser: %r" % report.get("std_runner_works"))
if gate == "g1" and report.get("sum") != "2499487497200":
    problems.append("wrong parallel sum: %r" % report.get("sum"))
if gate == "g2":
    cases = report.get("cases", [])
    if len(cases) != 22:
        problems.append("expected 22 cases, got %d" % len(cases))
    for c in cases:
        flag = "ok " if c["ok"] else "BAD"
        print("%s level %d n %4d threads %d block %dx%d  %8.1f ms  %s" % (
            flag, c["level"], c["n"], c["threads"], c["tile_k"], c["tile_j"], c["ms"], c["hash"]))
        if not c["ok"]:
            problems.append("hash mismatch: %r" % c)
    def ms(level, n, t):
        return next(c["ms"] for c in cases if (c["level"], c["n"], c["threads"], c["tile_k"]) == (level, n, t, 32))
    for level in (1, 2, 3):
        print("speedup level %d n 512: 1 -> 4 threads = %.2fx (indicative only)" % (level, ms(level, 512, 1) / ms(level, 512, 4)))
if problems:
    print("GATE %s: FAIL" % gate.upper())
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("GATE %s: PASS" % gate.upper())
PYEOF
