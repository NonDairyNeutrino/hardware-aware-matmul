"""Decides whether a browser gate passed, from the report its page posted.

Usage: python3 -I check_report.py GATE REPORT.json
Exits 0 on pass, 1 on failure. Gates:
  g1     the thread pool starts and a parallel sum is right
  g2     every case's hash equals the native hash (levels 0 to 4)
  g3     g2, run from the Astro production build under /hardware-aware-matmul/ with
         isolation supplied by the service worker rather than server headers
  probe  informational: records whether StdRunner works in the browser
  lite   g2's cases on the stable single-threaded build, on a page that is NOT isolated
  stepthrough  the chapters' <step-through> element on the lite build, from the Astro
         production build, with no isolation and no service worker
  g5     informational: records limits (pool start-up, re-init, panic, memory)
"""
import json
import sys

G2_CASES = 29
SPEEDUP_LEVELS = (1, 2, 3, 4)


def rows(blocks):
    return {"kind": "rows", "blocks": blocks}


def check_stepthrough(report):
    """Compares what the step-through page drew with what the core crate's plans say."""
    problems = []
    if report.get("base") != "/hardware-aware-matmul/":
        problems.append("wrong base path: %r" % report.get("base"))
    if report.get("sw_scopes") != []:
        problems.append("a service worker was registered (%r); the demo must not need one" % report.get("sw_scopes"))
    elements = {e["level"]: e for e in report.get("elements", [])}
    if sorted(elements) != [1, 2, 3, 4]:
        return problems + ["expected elements for levels 1 to 4, got %r" % sorted(elements)]
    for level, e in elements.items():
        env = e["env"]
        ok_tile = isinstance(env.get("micro_tile"), list) and len(env["micro_tile"]) == 2 and all(
            isinstance(x, int) and x > 0 for x in env["micro_tile"])
        if not (env.get("isa") and ok_tile and env.get("threads") is False):
            problems.append("level %d: bad env %r (the lite build has no threads)" % (level, env))
    one = elements[1]
    # `row_block_plan`'s own documented example: 10 rows over 4 threads.
    if one["plan"] != rows([[0, 3], [3, 6], [6, 9], [9, 10]]):
        problems.append("level 1 plan is %r" % one["plan"])
    if one["owners_by_row"] != [0, 0, 0, 1, 1, 1, 2, 2, 2, 3]:
        problems.append("level 1 row owners are %r" % one["owners_by_row"])
    if one["done_at_start"] != []:
        problems.append("level 1 started with rows already done: %r" % one["done_at_start"])
    after = report.get("after_step", {})
    if after.get("step") != "1" or after.get("done") != [0, 3, 6, 9]:
        problems.append("after one Step, expected rows 0,3,6,9 done at step 1, got %r" % after)
    if "Step 1 of 3" not in after.get("caption", ""):
        problems.append("caption after one Step is %r" % after.get("caption"))
    end = report.get("at_end", {})
    if end.get("step") != "3" or end.get("done") != list(range(10)):
        problems.append("at the end, expected every row done at step 3, got %r" % end)
    if report.get("three_threads") != rows([[0, 4], [4, 8], [8, 10]]):
        problems.append("after changing threads to 3 the plan is %r" % report.get("three_threads"))
    for level in (2, 3):
        if elements[level]["plan"] != rows([[0, 4], [4, 8]]):
            problems.append("level %d plan is %r" % (level, elements[level]["plan"]))
    # Level 2: B is 6 x 8 in 3 x 4 cache blocks.
    if elements[2]["b_blocks"] != 4:
        problems.append("level 2 drew %r cache blocks over B, expected 4" % elements[2]["b_blocks"])
    # Level 3: micro-tile lines inside two 4-row blocks of an 8-column output.
    if elements[3]["env"].get("micro_tile") != [4, 4]:
        problems.append("level 3 micro-tile is %r; the lite build's 4x4 is what keeps the grid-line check from being vacuous"
                        % (elements[3]["env"].get("micro_tile"),))
    mr, nr = elements[3]["env"]["micro_tile"]
    want = 2 * (len(range(mr, 4, mr)) + len(range(nr, 8, nr)))
    if elements[3]["micro_lines"] != want:
        problems.append("level 3 drew %r micro-tile lines, expected %d for %dx%d" % (elements[3]["micro_lines"], want, mr, nr))
    four = elements[4]
    want_tiles = [{"rows": [0, 4], "cols": [0, 4]}, {"rows": [0, 4], "cols": [4, 8]},
                  {"rows": [4, 8], "cols": [0, 4]}, {"rows": [4, 8], "cols": [4, 8]}]
    if four["plan"].get("kind") != "tiles" or four["plan"].get("tiles") != want_tiles:
        problems.append("level 4 plan is %r" % four["plan"])
    elif four["plan"]["depth"] != [[0, 3], [3, 6]] or four["plan"]["workers"] != 2:
        problems.append("level 4 depth/workers are %r / %r" % (four["plan"]["depth"], four["plan"]["workers"]))
    if four["tiles_drawn"] != 4:
        problems.append("level 4 drew %r tiles" % four["tiles_drawn"])
    return problems


def main(gate, path):
    report = json.load(open(path))
    cases = report.pop("cases", [])
    probes = report.pop("probes", [])
    print(json.dumps(report, indent=2))
    problems = []

    if not report.get("ok"):
        problems.append("page reported an error: " + str(report.get("error")))
    if gate in ("lite", "stepthrough"):
        if report.get("isolated"):
            problems.append("the %s gate must run on a page that is NOT cross-origin isolated" % gate)
    elif not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate not in ("g5", "lite", "stepthrough") and report.get("pool_threads") != 4:
        problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))

    if gate == "probe":
        print("StdRunner works in the browser: %r" % report.get("std_runner_works"))
    if gate == "g1" and report.get("sum") != "2499487497200":
        problems.append("wrong parallel sum: %r" % report.get("sum"))

    if gate in ("g2", "g3", "lite"):
        if len(cases) != G2_CASES:
            problems.append("expected %d cases, got %d" % (G2_CASES, len(cases)))
        for c in cases:
            flag = "ok " if c["ok"] else "BAD"
            print("%s level %d n %4d threads %d block %dx%d  %8.1f ms  %s" % (
                flag, c["level"], c["n"], c["threads"], c["tile_k"], c["tile_j"], c["ms"], c["hash"]))
            if not c["ok"]:
                problems.append("hash mismatch: %r" % c)

        def ms(level, n, threads):
            return next(c["ms"] for c in cases
                        if (c["level"], c["n"], c["threads"], c["tile_k"]) == (level, n, threads, 32))

        if not problems and gate != "lite":
            for level in SPEEDUP_LEVELS:
                print("speedup level %d n 512: 1 -> 4 threads = %.2fx (indicative only)"
                      % (level, ms(level, 512, 1) / ms(level, 512, 4)))

    if gate == "g3":
        if report.get("base") != "/hardware-aware-matmul/":
            problems.append("wrong base path: %r" % report.get("base"))
        if not report.get("loads", 0) >= 1:
            problems.append("the page never reloaded: isolation did not come from the service worker")
        scopes = report.get("sw_scopes")
        if not scopes or not all(s.endswith("/hardware-aware-matmul/") for s in scopes):
            problems.append("the service worker scope must be the site root /hardware-aware-matmul/, got %r" % scopes)

    if gate == "stepthrough":
        problems.extend(check_stepthrough(report))

    if gate == "g5":
        if not probes:
            problems.append("no probes were reported")
        for probe in probes:
            print("probe " + json.dumps(probe, sort_keys=True))

    if problems:
        print("GATE %s: FAIL" % gate.upper())
        for problem in problems:
            print(" -", problem)
        return 1
    print("GATE %s: PASS" % gate.upper())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
