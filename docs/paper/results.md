Every level was timed natively and in a web browser on one machine, and hardware events were
counted natively. This page reports the figures; the [Discussion](crate::discussion) says what
they mean.

Short on time? Skip to [Native](#native) for the tables and come back to
[What was measured](#what-was-measured) when a number needs context (it explains the †
marks).

# What was measured

- **Data.** Each case multiplies two square matrices of the project's order-sensitive test data
  (the same generator natively and in the browser), at sizes {{env sizes}}.
- **Timing.** The timer covers the multiplication only: the matrices are built once beforehand
  and the result is hashed afterwards. Each case ran {{env warmup}} untimed warm-up runs and
  then {{env repeats}} timed runs.
- **Statistics.** The tables show the **median** and, as the measure of noise, the
  **interquartile range** (IQR): the spread of the middle half of the runs, as a share of the
  median. Cases whose IQR is above 20% are marked † and are indicative only. Throughput is
  `2n³` floating-point operations divided by the median time.
- **Threads.** Level 0 is single-threaded; the other levels were run with each thread count
  shown. Thread counts above {{env physical_cores}} must share physical cores with other
  threads.
- **Blocks.** Levels 2 to 5 use cache blocks of {{env block}} (k by j) and level 5 uses output
  tiles of {{env tile}} (rows by columns by depth of the shared dimension).
- **Machine.** {{env cpu}}, with {{env physical_cores}} physical cores ({{env cores}} logical),
  running {{env os}} with the CPU governor set to {{env governor}}. The run was made on
  {{env date}} from commit {{env commit}}.
- **Native code.** Compiled with {{env rustc_native}} for {{env native_isa}} (RUSTFLAGS:
  {{env rustflags}}).
- **Browser code.** WebAssembly in {{env firefox}}, with {{env browser_isa}} enabled, in two
  builds:

| build | compiler | threads |
|---|---|---|
| lite | {{env rustc_lite}} | one |
| threaded | {{env rustc_threads}} | a pool of {{env pool}} |

Browser timings come from `performance.now()` on a cross-origin-isolated page. Browsers
deliberately coarsen their clocks, so very short times are less precise, and browser timings
depend on the browser, its clock resolution and its WebAssembly engine: read them as indicative.

# Native

> **Predict.** With all the threads, which level will be fastest, and how many times faster than level 0?

The tables give every level at the largest thread count measured ({{env threads_native}}
threads; level 0 has one), first at n = 512 and then at n = {{env largest}}.

# Throughput against matrix size, native

> **Predict.** Doubling n makes the arithmetic eight times larger. If a level's throughput
> (operations per second) stays the same as n grows, the machine is doing the same work per
> second on a larger problem. Which level's throughput will fall most?

The chart gives each level's throughput on one thread at every size measured, so that
the size is the only thing that changes.

# Thread scaling, native

> **Predict.** At how many threads will each level stop gaining?
> The machine has {{env physical_cores}} physical cores and {{env cores}} hardware threads.

Each level's median time at every measured thread count, with the speedup over one
thread in brackets, and the same speedups as a chart.

# In the browser

> **Predict.** The browser runs the same Rust, compiled to WebAssembly. Which level will lose
> the least against native code, and which the most?

The same cases ran in {{env firefox}} as WebAssembly, in two builds: a single-threaded
one (the **lite** build, which the step-through diagrams in the Methods also use) and a
threaded one on a pool of {{env pool}} threads. At n = {{env largest}}, level 3 took
{{ms simd lite}} in the lite build (one thread) and {{ms simd threads}} in the threaded
build ({{env threads_threaded}} threads); natively it took {{ms simd}}
({{env threads_native}} threads).

# Thread scaling in the browser

The threaded build, as in the native case. The lite build has one thread, so it has no
scaling to show.

# Hardware event counts

> **Predict.** Level 4 copies each block of the second matrix before using it. Will it need fewer cycles than level 3?

These counts show what the hardware did differently at each level.

A separate native run counted hardware events, with `perf stat`, one process per level, at two
sizes (1024 and {{env counters_n}}) on {{env counters_threads}} thread, counting user-space
events only, in a binary built with the same compiler as the timed native runs. Each count has
an operands-only run subtracted. The events were counted in groups small enough for the CPU's
counters, so none of them was time-shared, and each figure is the median of several processes.
The table gives the counts of one multiplication at each size.

# The same answer everywhere

For each size, all {{env runs}} cases (every level and thread count, natively and in both
browser builds) produced bit-identical results. Each run's output was hashed, and the
reference-run script refuses to produce this data unless every hash agrees for each size.

# Run it yourself

The [playground](crate::playground) runs the same benchmark on your own machine, in your
browser, and reports whether every level gave the same answer.
