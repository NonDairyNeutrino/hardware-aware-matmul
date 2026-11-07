#!/usr/bin/env python3
"""Hardware event counts for each level, from `perf stat`, as one JSON object.

usage: python3 -I web/dev/perf_counters.py [--n 1024] [--threads 1] [--reps 3]
                                           [--repeats 3] [--levels naive,simd,...]
                                           [--out counters.json]

Runs examples/level_once.rs once per level under `perf stat`, and counts, in user space
only: cycles, instructions, L1 data-cache loads and misses, last-level-cache loads and
misses, and data-TLB loads and misses. It answers the question the Discussion keeps
leaving open: whether a level is faster because it misses less.

How the numbers are made trustworthy:
* The events go to `perf` in groups small enough that each group fits the CPU's counters
  at once. With more events than counters the kernel time-shares them and reports scaled
  estimates; the script keeps every group below that, and records the smallest fraction of
  time any event was actually counted (`min_counted_pct`; 100 means never multiplexed).
* Building the operands costs events too. A run of level `none` (operands only) is
  measured with the same arguments and subtracted from every level.
* Each measurement is repeated `--repeats` times and the median is kept.
* Every level must print the same checksum, or the script stops: counts for a level that
  computed something else would mean nothing.

Counts are totals over the whole process (all threads), divided by `--reps` to give one
multiplication. They are the generic `perf` events, whose meaning depends on the CPU
model; an event the CPU does not offer is reported as null, not as zero.

Needs Linux, `perf`, and /proc/sys/kernel/perf_event_paranoid <= 2 (user-space counting of
your own processes). Run it on an otherwise idle machine, like the reference benchmark.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys

LEVELS = ["naive", "threaded", "cache_friendly", "simd", "packed", "streaming"]

# cycles and instructions use fixed counters on Intel CPUs and never compete for a
# programmable one, so they ride along with every group.
ALWAYS = ["cycles", "instructions"]
GROUPS = [
    ["L1-dcache-loads", "L1-dcache-load-misses"],
    ["LLC-loads", "LLC-load-misses"],
    ["dTLB-loads", "dTLB-load-misses"],
]
RATES = {  # name: (misses, accesses)
    "l1d_miss_rate": ("L1-dcache-load-misses", "L1-dcache-loads"),
    "llc_miss_rate": ("LLC-load-misses", "LLC-loads"),
    "dtlb_miss_rate": ("dTLB-load-misses", "dTLB-loads"),
}


def parse_perf_csv(text):
    """Parses `perf stat -x,` output into {event: (count or None, counted_pct)}.

    A line is `value,unit,event,run_time,percent_counted,...`. An event the CPU cannot
    count has the value `<not supported>` or `<not counted>`. A trailing `:u` on the event
    name is dropped so callers can use the plain names.
    """
    out = {}
    for line in text.splitlines():
        fields = line.split(",")
        if len(fields) < 5 or not fields[2]:
            continue
        value, event, pct = fields[0], fields[2], fields[4]
        event = event.split(":")[0]
        try:
            count = int(value)
        except ValueError:
            count = None
        try:
            counted = float(pct)
        except ValueError:
            counted = 0.0
        out[event] = (count, counted)
    return out


def net_counts(level_counts, baseline_counts):
    """Subtracts the operands-only run from a level's counts, event by event."""
    net = {}
    for event, count in level_counts.items():
        base = baseline_counts.get(event)
        if count is None or base is None:
            net[event] = None
        else:
            net[event] = max(count - base, 0)
    return net


def derive(per_mul):
    """Adds ratios to a level's per-multiplication counts. None when not computable."""
    out = dict(per_mul)
    for name, (misses, accesses) in RATES.items():
        m, a = per_mul.get(misses), per_mul.get(accesses)
        out[name] = m / a if m is not None and a else None
    cycles, instructions = per_mul.get("cycles"), per_mul.get("instructions")
    out["ipc"] = instructions / cycles if cycles and instructions is not None else None
    return out


def median_of(values):
    present = [v for v in values if v is not None]
    return statistics.median(present) if len(present) == len(values) and present else None


def check_environment():
    try:
        subprocess.run(["perf", "--version"], capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        sys.exit("perf is not installed (Arch: pacman -S perf; Debian: apt install linux-perf)")
    try:
        with open("/proc/sys/kernel/perf_event_paranoid") as f:
            paranoid = int(f.read())
    except OSError:
        paranoid = None
    if paranoid is not None and paranoid > 2:
        sys.exit(f"perf_event_paranoid is {paranoid}; user-space counting needs 2 or lower:\n"
                 "  sudo sysctl kernel.perf_event_paranoid=2")


def build_example(root):
    subprocess.run(["cargo", "build", "--release", "--example", "level_once"], cwd=root, check=True)
    meta = subprocess.run(["cargo", "metadata", "--format-version", "1", "--no-deps"], cwd=root,
                          capture_output=True, text=True, check=True)
    target = json.loads(meta.stdout)["target_directory"]
    return os.path.join(target, "release", "examples", "level_once")


def run_once(binary, level, args, events):
    """One `perf stat` run. Returns ({event: (count, pct)}, checksum)."""
    cmd = ["perf", "stat", "-x,", "-e", ",".join(e + ":u" for e in events), "--",
           binary, level, str(args.n), str(args.threads), str(args.reps)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"{' '.join(cmd)} failed:\n{proc.stderr}")
    return parse_perf_csv(proc.stderr), proc.stdout.strip()


def measure(binary, args, levels):
    """Median net counts per level, plus the smallest counted fraction seen."""
    results = {level: {} for level in levels}
    min_pct = 100.0
    checksums = {}
    for group in GROUPS:
        events = ALWAYS + group
        samples = {name: {e: [] for e in events} for name in levels + ["none"]}
        for _ in range(args.repeats):
            for name in levels + ["none"]:
                counts, checksum = run_once(binary, name, args, events)
                if name != "none":
                    checksums.setdefault(name, set()).add(checksum)
                for event in events:
                    count, pct = counts.get(event, (None, 0.0))
                    samples[name][event].append(count)
                    if count is not None:
                        min_pct = min(min_pct, pct)
        baseline = {e: median_of(v) for e, v in samples["none"].items()}
        for name in levels:
            level = {e: median_of(v) for e, v in samples[name].items()}
            for event, count in net_counts(level, baseline).items():
                results[name].setdefault(event, count)  # cycles/instructions: first group
    distinct = {c for sums in checksums.values() for c in sums}
    if len(distinct) != 1:
        sys.exit(f"the levels disagreed (checksums {checksums}); counts would not be comparable")
    return results, min_pct, distinct.pop()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=1024)
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--reps", type=int, default=3, help="multiplications per process")
    ap.add_argument("--repeats", type=int, default=3, help="processes per measurement (median kept)")
    ap.add_argument("--levels", default=",".join(LEVELS))
    ap.add_argument("--out", help="write JSON here instead of stdout")
    args = ap.parse_args()
    levels = args.levels.split(",")
    unknown = [lv for lv in levels if lv not in LEVELS]
    if unknown:
        sys.exit(f"unknown level(s): {', '.join(unknown)}")

    check_environment()
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    binary = build_example(root)
    results, min_pct, checksum = measure(binary, args, levels)

    per_mul = {}
    for level, counts in results.items():
        per_mul[level] = derive({e: (None if c is None else c / args.reps) for e, c in counts.items()})
    report = {
        "n": args.n, "threads": args.threads, "reps": args.reps, "repeats": args.repeats,
        "user_space_only": True, "min_counted_pct": min_pct, "checksum": checksum,
        "per_multiplication": per_mul,
    }
    text = json.dumps(report, indent=2) + "\n"
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    if min_pct < 100.0:
        print(f"warning: some events were counted only {min_pct:.0f}% of the time (the CPU "
              "time-shared its counters); treat those counts as estimates", file=sys.stderr)


if __name__ == "__main__":
    main()
