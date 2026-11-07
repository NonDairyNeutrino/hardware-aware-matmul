The same matrix product was timed at every level, natively and in a web browser, on one
machine. This page reports the measurements, with a question to answer before each
group of figures, and nothing else: the [Discussion](crate::discussion) compares them. Every figure on it comes from the committed
data of the reference run, not from this text.

# What was measured

Each case multiplies two square matrices of the project's order-sensitive test data (the
same generator natively and in the browser), at sizes {{env sizes}}. The timer covers the
multiplication only: the matrices are built once beforehand and the result is hashed
afterwards. Each case ran {{env warmup}} untimed warm-up runs and then {{env repeats}}
timed runs. The tables show the **median** and, as the measure of noise, the
**interquartile range** (IQR): the spread of the middle half of the runs, as a share of
the median. Cases whose IQR is above 20% are marked †. Throughput is `2n³`
floating-point operations divided by the median time. Level 0 is single-threaded; the
other levels were run with each thread count shown. Levels 2 to 4 use cache blocks of
{{env block}} (k by j) and level 4 uses output tiles of {{env tile}} (rows by columns by
depth of the shared dimension).

The reference machine: {{env cpu}}, with {{env physical_cores}} physical cores
({{env cores}} logical), running {{env os}} with the CPU governor set to
{{env governor}}. The run was made on {{env date}} from commit {{env commit}}.
Native code was compiled with {{env rustc_native}} for {{env native_isa}} (RUSTFLAGS:
{{env rustflags}}). Browser code ran as WebAssembly in {{env firefox}},
compiled with {{env rustc_lite}} (the lite build) and {{env rustc_threads}} (the threaded
build) with {{env browser_isa}} enabled; the threaded build used a pool of {{env pool}}
threads.

# Native

> **Predict.** Before you read the tables: level 0 and level 1 run the same loop, level 1
> split across threads. Which is faster on one thread? How much faster is level 2 than level
> 0 on one thread, and is the gap bigger at the smaller size or the larger one?

The tables give every level at the largest thread count measured ({{env threads_native}}
threads; level 0 has one), first at n = 512 and then at n = {{env largest}}.

# Throughput against matrix size, native

> **Predict.** Doubling n makes the arithmetic eight times larger. Does the time grow eight
> times? If a level's throughput (operations per second) stays the same as n grows, the machine
> is doing the same work per second on a larger problem; if it falls, something got in the way.
> Which level's throughput will fall most?

The chart gives each level's throughput on one thread at every size measured, so that
the size is the only thing that changes.

# Thread scaling, native

> **Predict.** How many threads will each level use well before more threads stop helping?
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

# The same answer everywhere

All {{env runs}} measured cases (each timed {{env repeats}} times), every level and every thread count, natively and in both
browser builds, produced the same result for each matrix size, bit for bit. Each run's
output was hashed, and the reference-run script refuses to produce this data unless every
hash agrees for each size.

# Run it yourself

The [playground](crate::playground) runs the same benchmark on your own machine, in your
browser, and reports whether every level gave the same answer.

# Noise and limits

These are the measurements of one machine on one day.

- The IQR column shows how much the runs of each case varied. Cases marked † varied by
  more than 20% of their median and are indicative only.
- Thread counts above {{env physical_cores}} must share physical cores with other
  threads.
- Browser timings come from `performance.now()` on a cross-origin-isolated page.
  Browsers deliberately coarsen their clocks, so very short times are less precise.
- The numbers describe this hardware and these compilers.
- Browser timings are indicative: they depend on the browser, its clock resolution and its
  WebAssembly engine.
