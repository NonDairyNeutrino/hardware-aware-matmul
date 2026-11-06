"""Decides whether a browser gate passed, from the report its page posted.

Usage: python3 -I check_report.py GATE REPORT.json
Exits 0 on pass, 1 on failure. Gates:
  g1     the thread pool starts and a parallel sum is right
  g2     every case's hash equals the native hash (levels 0 to 4)
  g3     g2, run from the Astro production build under /matmul_levels.rs/ with
         isolation supplied by the service worker rather than server headers
  probe  informational: records whether StdRunner works in the browser
  g5     informational: records limits (pool start-up, re-init, panic, memory)
"""
import json
import sys

G2_CASES = 29
SPEEDUP_LEVELS = (1, 2, 3, 4)


def main(gate, path):
    report = json.load(open(path))
    cases = report.pop("cases", [])
    probes = report.pop("probes", [])
    print(json.dumps(report, indent=2))
    problems = []

    if not report.get("ok"):
        problems.append("page reported an error: " + str(report.get("error")))
    if not report.get("isolated"):
        problems.append("page is not cross-origin isolated")
    if gate != "g5" and report.get("pool_threads") != 4:
        problems.append("expected a pool of 4 threads, got %r" % report.get("pool_threads"))

    if gate == "probe":
        print("StdRunner works in the browser: %r" % report.get("std_runner_works"))
    if gate == "g1" and report.get("sum") != "2499487497200":
        problems.append("wrong parallel sum: %r" % report.get("sum"))

    if gate in ("g2", "g3"):
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

        if not problems:
            for level in SPEEDUP_LEVELS:
                print("speedup level %d n 512: 1 -> 4 threads = %.2fx (indicative only)"
                      % (level, ms(level, 512, 1) / ms(level, 512, 4)))

    if gate == "g3":
        if report.get("base") != "/matmul_levels.rs/":
            problems.append("wrong base path: %r" % report.get("base"))
        if not report.get("loads", 0) >= 1:
            problems.append("the page never reloaded: isolation did not come from the service worker")

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
