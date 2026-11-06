The same matrix product was timed at every level, natively and in a web browser, on one
machine. This page reports the measurements and nothing else: the Discussion compares
them. Every figure on it comes from the committed data of the reference run, not from
this text.

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
{{env block}} and level 4 uses output tiles of {{env tile}}.

The reference machine: {{env cpu}}, with {{env physical_cores}} physical cores
({{env cores}} logical), running {{env os}} with the CPU governor set to
{{env governor}}. The run was made on {{env date}} from commit {{env commit}}.
Native code was compiled with {{env rustc_native}} for the baseline instruction set of
the target ({{env native_isa}}). Browser code ran as WebAssembly in {{env firefox}},
compiled with {{env rustc_lite}} (the lite build) and {{env rustc_threads}} (the threaded
build) with {{env browser_isa}} enabled; the threaded build used a pool of {{env pool}}
threads.

# Native

At n = {{env largest}}, level 0 took {{ms naive}} and level 3 took {{ms simd}} at the
largest thread count: {{speedup simd/naive}} faster.

# Thread scaling, native

Each level's median time at every measured thread count, with the speedup over one
thread in brackets, and the same speedups as a chart.

# In the browser

The same cases ran in {{env firefox}} as WebAssembly, in two builds: a single-threaded
one (the **lite** build, which the step-through diagrams in the Methods also use) and a
threaded one on a pool of {{env pool}} threads. At n = {{env largest}}, level 3 took
{{ms simd lite}} in the lite build and {{ms simd threads}} in the threaded build;
natively it took {{ms simd}}.

# Thread scaling in the browser

The threaded build, as in the native case. The lite build has one thread, so it has no
scaling to show.

# The same answer everywhere

All {{env runs}} measured runs, every level and every thread count, natively and in both
browser builds, produced the same result for each matrix size, bit for bit. Each run's
output was hashed, and the reference-run script refuses to produce this data unless every
hash agrees for each size. The arithmetic does not change from level to level; only how
the hardware is used does.

# Noise and limits

These are the measurements of one machine on one day.

- The IQR column shows how much the runs of each case varied. Cases marked † varied by
  more than 20% of their median and are indicative only.
- Thread counts above {{env physical_cores}} must share physical cores with other
  threads, so they cannot be expected to scale like the lower ones.
- Browser timings come from `performance.now()` on a cross-origin-isolated page.
  Browsers deliberately coarsen their clocks, so very short times are less precise.
- The numbers describe this hardware and these compilers. Read the ratios as showing the
  size of the effects on this machine, not as constants.
