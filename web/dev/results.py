"""Assembles the reference run's results.json from the native and browser reports.

usage: python3 -I results.py --native N.json --lite L.json --threads T.json --out OUT.json
                             [--allow-unknown]
       python3 -I results.py --check results.json

The inputs are the JSON the native bench example and the two browser bench pages print
(`web/wasm/examples/bench.rs`, `web/wasm/www/bench.html`). The output is one document
(schema 1):

  schema, generated    the schema number and the UTC time of assembly
  environment          what the numbers were measured on: cpu, logical_cores,
                       physical_cores, browser_cores (navigator.hardwareConcurrency),
                       browser_isolated (per browser build), governor, on_ac_power,
                       load_average_start, os, toolchains (rustc per build: native,
                       browser-lite, browser-threads), wasm_bindgen_cli,
                       wasm_target_features (per browser build), rustflags, firefox,
                       commit, native_isa, native_micro_tile, browser_isa, browser_pool
  parameters           sizes, repeats, warmup, block, tile and the thread counts per
                       environment
  runs                 one per measured case: environment, level, n, threads, repeats,
                       times_ms, median_ms, min_ms, max_ms, spread ((max - min) / median),
                       gflops and the result hash

It refuses to write anything unless the project's invariant holds in the data: for each
matrix size, **every** run (every level, thread count, native and browser) produced the
same result hash. It also checks that every environment measured exactly the expected
cases, that each case has the expected number of repeats, that the three reports have the
right kind and agree on the parameters (including the cache block and tile), that the two
browser builds report the same instruction set, and that nothing in the environment record
is unknown (unless --allow-unknown). `--check` re-derives every statistic from times_ms,
so a hand-edited file is refused.
"""
import argparse
import datetime
import glob
import json
import math
import os
import platform
import statistics
import subprocess
import sys

SCHEMA = 1
ENVIRONMENTS = ("native", "browser-lite", "browser-threads")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
# The wasm target features of each browser build. They must match web/wasm/build-lite.sh
# and web/wasm/build.sh.
WASM_TARGET_FEATURES = {"browser-lite": "simd128", "browser-threads": "atomics, bulk-memory, simd128"}


class ResultsError(Exception):
    """The data breaks a rule; nothing is written."""


def _spread(times):
    return round((max(times) - min(times)) / statistics.median(times), 4)


def _gflops(n, median):
    return round(2 * n ** 3 / (median / 1000) / 1e9, 4)


def _summarise(environment, report):
    """The runs of one report, with median, min, max, spread and GFLOP/s added."""
    runs = []
    for run in report["runs"]:
        times = run["times_ms"]
        median = statistics.median(times)
        runs.append({
            "environment": environment,
            "level": run["level"],
            "n": run["n"],
            "threads": run["threads"],
            "repeats": len(times),
            "times_ms": times,
            "median_ms": round(median, 4),
            "min_ms": min(times),
            "max_ms": max(times),
            "spread": _spread(times),
            "gflops": _gflops(run["n"], median),
            "hash": run["hash"],
        })
    return runs


def _thread_counts(report):
    return sorted({run["threads"] for run in report["runs"] if run["level"] != 0})


def _close(a, b):
    # Values are rounded to 4 decimals, hence the absolute tolerance.
    return math.isclose(a, b, rel_tol=1e-3, abs_tol=1e-4)


def check(document):
    """Raises ResultsError unless the document obeys every rule."""
    try:
        _check(document)
    except (KeyError, TypeError, ValueError, AttributeError, IndexError, ZeroDivisionError) as error:
        raise ResultsError("malformed results document (%s: %s)" % (type(error).__name__, error))


def _check(document):
    if document.get("schema") != SCHEMA:
        raise ResultsError("unknown schema %r" % document.get("schema"))
    parameters = document["parameters"]
    sizes, repeats = parameters["sizes"], parameters["repeats"]
    runs = document["runs"]
    if not runs:
        raise ResultsError("no runs")
    for run in runs:
        if run["environment"] not in ENVIRONMENTS:
            raise ResultsError("unknown environment %r" % (run["environment"],))
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
        where = "%s level %d n %d threads %d" % (run["environment"], run["level"], run["n"], run["threads"])
        times = run["times_ms"]
        if run["repeats"] != repeats or len(times) != repeats:
            raise ResultsError("%s: %d repeats, expected %d" % (where, len(times), repeats))
        if min(times) <= 0:
            raise ResultsError("a non-positive time in %r" % run)
        median = statistics.median(times)
        derived = {
            "median_ms": median,
            "min_ms": min(times),
            "max_ms": max(times),
            "gflops": _gflops(run["n"], median),
            "spread": _spread(times),
        }
        for key, value in derived.items():
            if not _close(run[key], value):
                raise ResultsError("%s: %s is %r but times_ms give %r" % (where, key, run[key], value))


def _unknown(value):
    return value is None or value == "unknown" or value == ""


def _check_known(environment):
    unknown = [key for key in ("cpu", "firefox", "commit") if _unknown(environment.get(key))]
    toolchains = environment.get("toolchains") or {}
    unknown += ["toolchains.%s" % name for name in ENVIRONMENTS if _unknown(toolchains.get(name))]
    if unknown:
        raise ResultsError("unknown environment information: %s (fix the lookup, or pass --allow-unknown)"
                           % ", ".join(unknown))


def assemble(native, lite, threads, environment, generated, allow_unknown=False):
    """The results document from the three reports and the recorded environment."""
    slots = (("native", native), ("browser-lite", lite), ("browser-threads", threads))
    for name, report in slots:
        if report.get("ok") is False:
            raise ResultsError("%s report is not ok: %s" % (name, report.get("error")))
        if report.get("kind") != name:
            raise ResultsError("the %s slot holds a report of kind %r" % (name, report.get("kind")))
    if not allow_unknown:
        _check_known(environment)
    params = native["parameters"]
    for name, report in slots[1:]:
        got = report["parameters"]
        for key in ("sizes", "repeats", "warmup"):
            if got[key] != params[key]:
                raise ResultsError("%s was run with different %s (%r) than native (%r)" % (name, key, got[key], params[key]))
        for key in ("block", "tile"):
            if got.get(key) != params[key]:
                raise ResultsError("%s reports %s %r, native uses %r" % (name, key, got.get(key), params[key]))
    if lite["env"]["isa"] != threads["env"]["isa"]:
        raise ResultsError("the two browser builds report different instruction sets (%r and %r)"
                           % (lite["env"]["isa"], threads["env"]["isa"]))
    environment = dict(environment)
    environment["browser_isa"] = threads["env"]["isa"]
    environment["browser_pool"] = threads.get("pool_threads")
    environment["browser_cores"] = threads["cores"]
    environment["browser_isolated"] = {"browser-lite": lite.get("isolated"),
                                       "browser-threads": threads.get("isolated")}
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


def _run(*command, cwd=None):
    """The command's output, or None if it could not be run."""
    try:
        return subprocess.run(command, capture_output=True, text=True, check=True, cwd=cwd).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _read(path):
    try:
        with open(path) as handle:
            return handle.read()
    except OSError:
        return None


def _count_physical_cores(cpuinfo):
    """Distinct (physical id, core id) pairs in /proc/cpuinfo text, or None."""
    pairs, physical = set(), None
    for line in cpuinfo.splitlines():
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if key == "physical id":
            physical = value
        elif key == "core id" and physical is not None:
            pairs.add((physical, value))
    return len(pairs) or None


def _on_ac_power():
    """True/False from the Mains supplies in /sys/class/power_supply, or None if unknown."""
    states = []
    for supply in glob.glob("/sys/class/power_supply/*"):
        kind, online = _read(supply + "/type"), _read(supply + "/online")
        if kind is not None and kind.strip() == "Mains" and online is not None:
            states.append(online.strip() == "1")
    return any(states) if states else None


def _load_average_start():
    try:
        return float(os.environ["BENCH_LOAD_START"])
    except (KeyError, ValueError):
        return None


def collect_environment(native):
    """What this machine and toolchain are, for the record. None marks what was not found."""
    root = os.path.normpath(ROOT)
    wasm = os.path.join(root, "web", "wasm")
    cpuinfo = _read("/proc/cpuinfo")
    cpu = None
    if cpuinfo:
        for line in cpuinfo.splitlines():
            if line.startswith("model name"):
                cpu = line.split(":", 1)[1].strip()
                break
    status = _run("git", "status", "--porcelain", "--untracked-files=no", cwd=root)
    commit = _run("git", "rev-parse", "HEAD", cwd=root)
    if commit is not None and status:
        commit += " (with uncommitted changes)"
    governor = _read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")
    # web/wasm/rust-toolchain.toml pins the nightly that the native example and the threaded
    # wasm build use; build-lite.sh uses +stable.
    nightly = _run("rustc", "-V", cwd=wasm)
    return {
        "cpu": cpu,
        "logical_cores": native["cores"],
        "physical_cores": _count_physical_cores(cpuinfo) if cpuinfo else None,
        "governor": governor.strip() if governor else None,
        "on_ac_power": _on_ac_power(),
        "load_average_start": _load_average_start(),
        "os": platform.platform(),
        "toolchains": {
            "native": nightly,
            "browser-lite": _run("rustc", "+stable", "-V", cwd=wasm),
            "browser-threads": nightly,
        },
        "wasm_bindgen_cli": _run(os.environ.get("WASM_BINDGEN") or "wasm-bindgen", "--version"),
        "wasm_target_features": dict(WASM_TARGET_FEATURES),
        "rustflags": os.environ.get("RUSTFLAGS", ""),
        "firefox": _run("firefox", "--version"),
        "commit": commit,
        "native_isa": native["isa"],
        "native_micro_tile": native["micro_tile"],
    }


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--native")
    parser.add_argument("--lite")
    parser.add_argument("--threads")
    parser.add_argument("--out")
    parser.add_argument("--check")
    parser.add_argument("--allow-unknown", action="store_true",
                        help="write the file even if the environment record has unknown entries")
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
        document = assemble(native, lite, threads, collect_environment(native), generated,
                            allow_unknown=args.allow_unknown)
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
