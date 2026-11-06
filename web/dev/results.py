"""Assembles the reference run's results.json from the native and browser reports.

usage: python3 -I results.py --native N.json --lite L.json --threads T.json --out OUT.json
       python3 -I results.py --check results.json

The inputs are the JSON the native bench example and the two browser bench pages print
(`web/wasm/examples/bench.rs`, `web/wasm/www/bench.html`). The output is one document:
the recorded environment, the parameters, and one entry per measured case with its
median, minimum, maximum and GFLOP/s.

It refuses to write anything unless the project's invariant holds in the data: for each
matrix size, **every** run (every level, thread count, native and browser) produced the
same result hash. It also checks that every environment measured exactly the expected
cases and that each case has the expected number of repeats.
"""
import argparse
import datetime
import json
import os
import platform
import statistics
import subprocess
import sys

SCHEMA = 1
ENVIRONMENTS = ("native", "browser-lite", "browser-threads")


class ResultsError(Exception):
    """The data breaks a rule; nothing is written."""


def _summarise(environment, report):
    """The runs of one report, with median, min, max and GFLOP/s added."""
    runs = []
    for run in report["runs"]:
        times = run["times_ms"]
        median = statistics.median(times)
        n = run["n"]
        runs.append({
            "environment": environment,
            "level": run["level"],
            "n": n,
            "threads": run["threads"],
            "repeats": len(times),
            "times_ms": times,
            "median_ms": round(median, 4),
            "min_ms": min(times),
            "max_ms": max(times),
            "gflops": round(2 * n ** 3 / (median / 1000) / 1e9, 4),
            "hash": run["hash"],
        })
    return runs


def _thread_counts(report):
    return sorted({run["threads"] for run in report["runs"] if run["level"] != 0})


def check(document):
    """Raises ResultsError unless the document obeys every rule."""
    if document.get("schema") != SCHEMA:
        raise ResultsError("unknown schema %r" % document.get("schema"))
    parameters = document["parameters"]
    sizes, repeats = parameters["sizes"], parameters["repeats"]
    runs = document["runs"]
    if not runs:
        raise ResultsError("no runs")
    # The invariant: one hash per matrix size, whatever the level, threads or environment.
    hashes = {}
    for run in runs:
        hashes.setdefault(run["n"], set()).add(run["hash"])
    for n, found in sorted(hashes.items()):
        if len(found) != 1:
            raise ResultsError("n=%d: the runs disagree on the result: %s" % (n, sorted(found)))
    # Every environment measured exactly the expected cases.
    for environment in ENVIRONMENTS:
        threads = parameters["threads"][environment]
        expected = set()
        for n in sizes:
            expected.add((0, n, 1))
            for level in range(1, 5):
                for t in threads:
                    expected.add((level, n, t))
        found = [(r["level"], r["n"], r["threads"]) for r in runs if r["environment"] == environment]
        if sorted(found) != sorted(expected):
            missing = sorted(expected - set(found))
            extra = sorted(set(found) - expected)
            dup = len(found) - len(set(found))
            raise ResultsError("%s: wrong set of cases (missing %s, unexpected %s, %d duplicates)"
                               % (environment, missing[:3], extra[:3], dup))
    for run in runs:
        if run["repeats"] != repeats or len(run["times_ms"]) != repeats:
            raise ResultsError("%s level %d n %d threads %d: %d repeats, expected %d"
                               % (run["environment"], run["level"], run["n"], run["threads"], run["repeats"], repeats))
        if min(run["times_ms"]) <= 0:
            raise ResultsError("a non-positive time in %r" % run)


def assemble(native, lite, threads, environment, generated):
    """The results document from the three reports and the recorded environment."""
    for name, report in (("native", native), ("browser-lite", lite), ("browser-threads", threads)):
        if report.get("ok") is False:
            raise ResultsError("%s report is not ok: %s" % (name, report.get("error")))
    params = native["parameters"]
    for name, report in (("browser-lite", lite), ("browser-threads", threads)):
        got = report["parameters"]
        for key in ("sizes", "repeats", "warmup"):
            if got[key] != params[key]:
                raise ResultsError("%s was run with different %s (%r) than native (%r)" % (name, key, got[key], params[key]))
    document = {
        "schema": SCHEMA,
        "generated": generated,
        "environment": environment,
        "parameters": {
            "sizes": params["sizes"],
            "repeats": params["repeats"],
            "warmup": params["warmup"],
            "block": params["block"],
            "tile": params["tile"],
            "threads": {
                "native": _thread_counts(native),
                "browser-lite": _thread_counts(lite),
                "browser-threads": _thread_counts(threads),
            },
        },
        "runs": _summarise("native", native) + _summarise("browser-lite", lite) + _summarise("browser-threads", threads),
    }
    check(document)
    return document


def _run(*command):
    try:
        return subprocess.run(command, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def collect_environment(native, threads):
    """What this machine and toolchain are, for the record."""
    cpu = "unknown"
    try:
        with open("/proc/cpuinfo") as cpuinfo:
            for line in cpuinfo:
                if line.startswith("model name"):
                    cpu = line.split(":", 1)[1].strip()
                    break
    except OSError:
        pass
    dirty = bool(_run("git", "status", "--porcelain", "--untracked-files=no"))
    return {
        "cpu": cpu,
        "logical_cores": native["cores"],
        "os": platform.platform(),
        "rustc": _run("rustc", "-V"),
        "rustflags": os.environ.get("RUSTFLAGS", ""),
        "firefox": _run("firefox", "--version"),
        "commit": _run("git", "rev-parse", "HEAD") + (" (with uncommitted changes)" if dirty else ""),
        "native_isa": native["isa"],
        "native_micro_tile": native["micro_tile"],
        "browser_isa": threads["env"]["isa"],
        "browser_pool": threads.get("pool_threads"),
    }


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--native")
    parser.add_argument("--lite")
    parser.add_argument("--threads")
    parser.add_argument("--out")
    parser.add_argument("--check")
    args = parser.parse_args(argv)
    try:
        if args.check:
            document = json.load(open(args.check))
            check(document)
            print("results.py: %s is valid (%d runs)" % (args.check, len(document["runs"])))
            return 0
        if not (args.native and args.lite and args.threads and args.out):
            parser.error("give --native, --lite, --threads and --out, or --check")
        native, lite, threads = (json.load(open(path)) for path in (args.native, args.lite, args.threads))
        generated = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        document = assemble(native, lite, threads, collect_environment(native, threads), generated)
        with open(args.out, "w") as out:
            json.dump(document, out, indent=1)
            out.write("\n")
        print("results.py: wrote %s (%d runs, all hashes agree)" % (args.out, len(document["runs"])))
        return 0
    except ResultsError as error:
        print("results.py: REFUSING: %s" % error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
