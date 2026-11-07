The [Results](crate::results) report what was measured; this page compares it. Everything
below refers to the reference run: one laptop, one day, one browser. Every figure is filled
in from that run's committed data. Where a sentence explains a difference rather than
reports it, the sentence says so, and where the data cannot tell two explanations apart,
the page says that too.

# The answer does not change

All {{env runs}} measured cases produced the same result for each matrix size, bit for
bit: every level, every thread count, natively and in both browser builds. That is the
premise of the comparison, and it is what separates it from a comparison of algorithms. No
level does fewer multiply-adds than another, or different ones: each output element is
still the sum of the same products, added in the same order. Every difference below is therefore a difference in how well the same
arithmetic was fed to the hardware, and none of the speed was bought with a different
answer.

# Where the single-thread gain comes from

At n = {{env largest}}, on one thread, the naive loop took {{ms naive}}. Level 2 took
{{ms cache_friendly t=1}}, which is {{speedup cache_friendly/naive t=1}} faster. Level 3
took {{ms simd t=1}}, {{speedup simd/naive t=1}} faster than level 0 but only
{{speedup simd/cache_friendly t=1}} faster than level 2. Most of the single-thread
gain therefore arrives with level 2, which changes the
[loop order and blocks for the cache](crate::cache_friendly). A plausible reading is that
the same operations, arranged this way, use data while it is still in the cache instead of
fetching it from memory again; the run did not measure that.

The size of that gain depends on the size of the problem. At n = 512 level 2 was
{{speedup cache_friendly/naive t=1 n=512}} faster than level 0 on one thread; at
n = {{env largest}} it was {{speedup cache_friendly/naive t=1}} faster. This is what one
would expect if the cause is the memory system: the larger the matrices, the more often the
naive loop's reads down a column of the second matrix miss the cache. The data show the
trend; they do not isolate the cause, which would take cache measurements that were not
made.

Level 3's gain over level 2 is much smaller, though its micro-kernel
[keeps a block of the output in vector registers](crate::simd). The experiment does not
show how much of level 2's speed already comes from the compiler vectorising its inner
loop, which would need the generated assembly, so it cannot say how much of the possible
gain level 3 captures.

Level 1 on one thread ({{ms threaded t=1}}) is no faster than level 0
({{speedup threaded/naive t=1}}), as it should be: [threads](crate::threaded) change
nothing until there is more than one of them.

# What threads add

Level 1 scales almost perfectly from one thread to two: {{ms threaded t=1}} falls to
{{ms threaded t=2}}. It then reaches {{ms threaded t=4}} with four threads and
{{ms threaded t=8}} with eight, which is still an improvement although the machine has only
{{env physical_cores}} physical cores. One plausible reading is that level 1's inner loop
spends much of its time waiting for memory, and a thread that is waiting leaves its core
free for the thread that shares it. The measurements are consistent with that, and do not
test it.

Levels 2, 3 and 4 behave differently. Level 3 takes {{ms simd t=1}} on one thread,
{{ms simd t=2}} on two and {{ms simd t=4}} on four, and then {{ms simd t=8}} on eight: no
gain from the second four threads. Levels 2 and 4 do the same: level 2 takes
{{ms cache_friendly t=4}} on four threads and {{ms cache_friendly t=8}} on eight, level 4
takes {{ms streaming t=4}} and {{ms streaming t=8}}. For these three levels the scaling
stops where the physical cores run out, not where the hardware threads do. The Methods
say that threads stop helping when something they share is used up, such as the memory
system, and the plateau is consistent with that. It is just as consistent with hyper-threads sharing the execution units of one
core, and the experiment cannot tell the two apart. Hardware counters for memory traffic
and for execution-unit use could.

The throughput of the fastest levels also depends on the problem size. Level 3 on four
threads reaches {{gflops simd t=4 n=512}} at n = 512 and {{gflops simd t=4}} at
n = {{env largest}}: the smaller problem runs faster, again as one would expect if the
memory system, not the arithmetic, sets the pace.

Taken together, level 3 with {{env threads_native}} threads is {{speedup simd/naive}} faster
than the textbook loop at n = {{env largest}}, with the same answer. Level 4 on four
threads is slightly faster still ({{speedup streaming/naive t=4}}).

# What streaming costs

[Level 4](crate::streaming) exists to make the problem possible when the matrices do not
fit in memory, not to make it faster when they do, and the chapter says so. The reference
run measures the cost of that generality only on matrices that fit. It is small. At
n = {{env largest}}, level 4 takes {{ms streaming t=1}} on one thread against level 3's
{{ms simd t=1}}, {{ms streaming t=4}} on four against {{ms simd t=4}}, and
{{ms streaming t=8}} on eight against {{ms simd t=8}}. On two threads it is ahead,
{{ms streaming t=2}} against {{ms simd t=2}}, by more than the noise of either
({{iqr streaming t=2}} and {{iqr simd t=2}}); the reference run does not explain that.
At one, four and eight threads the two levels are within a few percent of each other, level
4 slightly behind at one thread and slightly ahead at four and eight. On this machine, with
matrices that fit in memory, copying tiles into buffers cost little.

# Browser against native

The same Rust code, compiled to WebAssembly and run in {{env firefox}}, is usually slower
than the native build, and by an amount that depends on the level. In the browser's
single-threaded build, level 3 took
{{ms simd lite}} in the browser's single-threaded build against {{ms simd t=1}} natively.
Level 0 took {{ms naive lite}} against {{ms naive}}, level 2 took
{{ms cache_friendly lite}} against {{ms cache_friendly t=1}}, and level 4 took
{{ms streaming lite}} against {{ms streaming t=1}}. The level written around vector
registers is the one that comes closest to native speed. Both builds use 128-bit vectors,
{{env native_isa}} natively and {{env browser_isa}} in the browser, so the level 3
micro-kernel asks for the same width in both. That is a reason to expect it to travel well;
the experiment shows that it does, but not why the others lose more.

The gaps between the levels are therefore not the same in the two environments. Natively,
level 4 stays close to level 3. In the browser's single-threaded build it takes
{{ms streaming lite}} against level 3's {{ms simd lite}}. The reference run does not show why:
the tile copies, or another part of level 4's loop, may cost more in WebAssembly than they
do natively.

With threads, level 3 matches native speed: it took {{ms simd threads}} in the
browser's threaded build ({{env threads_threaded}} threads), against {{ms simd}} natively
({{env threads_native}} threads). At n = {{env largest}} it also stops improving after four threads,
like the native build: {{ms simd threads t=4}} on four threads, {{ms simd threads t=8}} on
eight. The reference run does not say why the threaded build is not slower here.

The two browser builds differ in more than threads. The single-threaded build was compiled
with {{env rustc_lite}}, the threaded one, like the native code, with {{env rustc_threads}},
and only the threaded build uses shared memory. On one thread the threaded build was slower
for level 1 ({{ms threaded threads t=1}} against {{ms threaded lite}}) and faster for level
3 ({{ms simd threads t=1}} against {{ms simd lite}}). Which of the differences between the
builds causes which result is not something this experiment can separate.

# What the measurements cannot say

- **One machine, one day, one browser.** The reference run used {{env cpu}} with the CPU
  governor set to {{env governor}}, on {{env date}}, in {{env firefox}}. Another CPU, with
  other cache sizes and another memory system, would give other ratios. The playground
  lets a reader repeat the browser measurements on their own machine.
- **Two sizes.** The sizes were {{env sizes}}. Trends with the size, such as the growing
  gain of cache blocking, rest on two points.
- **Baseline vectors, no fused multiply-add.** Native code was built for {{env native_isa}}
  (recorded RUSTFLAGS: {{env rustflags}}), the baseline of the platform and not of this CPU. By
  design no level uses fused multiply-add, which would change the result bits. Both choices
  keep the comparison honest and keep the results identical. They also mean that none of
  these figures is the most this CPU can do.
- **Explanations are interpretations.** The levels were timed, not profiled. In the reference run used here the cache sizes
  of the machine were not recorded and no hardware counters were read, so each statement
  above about why a difference arises is a reading consistent with the numbers, not a
  measurement of the cause.
- **Noise.** Cases whose interquartile range exceeds 20% of the median are marked † on the
  Results page and should be read as indicative. Browser timings in particular depend on
  the browser's clock and engine.
