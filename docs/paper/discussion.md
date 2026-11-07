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

The size of that gain depends on the size of the problem, though not smoothly. On one
thread level 2 was {{speedup cache_friendly/naive t=1 n=256}} faster than level 0 at
n = 256, {{speedup cache_friendly/naive t=1 n=512}} at n = 512,
{{speedup cache_friendly/naive t=1 n=1024}} at n = 1024 and
{{speedup cache_friendly/naive t=1}} at n = {{env largest}}. The gain barely moves between
the two smaller sizes and grows after them, mostly because level 0 slows down: its
throughput is {{gflops naive n=512}} at n = 512, {{gflops naive n=1024}} at n = 1024 and
{{gflops naive}} at n = {{env largest}}. This is what one would expect if the cause is the
memory system, and two things about this machine's caches change between n = 512 and
n = 1024. The three matrices together take 6 MiB at n = 512, which fits in the {{env l3}}
last-level cache, and 24 MiB at n = 1024, which does not. And the naive loop's walk down a
column of the second matrix touches n cache lines, 32 KiB at n = 512, as much as the
{{env l1d}} L1 data cache holds, and 64 KiB at n = 1024 (the [primer](crate::primer)
explains why). Either could explain the fall, and the data cannot tell them apart; nor can
they rule out a third cause, such as rows whose length is a power of two competing for the
same places in a cache. That would take cache-miss counts: the run recorded the sizes of the
caches, but not how often they missed.

Level 3's gain over level 2 is much smaller, though its micro-kernel
[keeps a block of the output in vector registers](crate::simd). The experiment does not
show how much of level 2's speed already comes from the compiler vectorising its inner
loop, which would need the generated assembly, so it cannot say how much of the possible
gain level 3 captures.

Level 1 on one thread ({{ms threaded t=1}}) is no faster than level 0
({{speedup threaded/naive t=1}}), as it should be: [threads](crate::threaded) change
nothing until there is more than one of them.

# What threads add

Level 1 is the hardest level to read at n = {{env largest}}, because its one-thread time is
uncertain. Like level 0's, its {{env repeats}} one-thread runs did not all land near the
median: most did, and the rest were clearly faster, so the medians ({{ms threaded t=1}} for
level 1, {{ms naive}} for level 0) depend on how many runs happened to be fast. Their
interquartile ranges ({{iqr threaded t=1}} and {{iqr naive}}) stay under the 20% mark, so
the Results do not flag them, but they should be read with that caveat; so should every
speedup over level 0 at this size, which divides by that median. With two threads level 1
takes {{ms threaded t=2}}, more than twice as fast, which probably says more about the
one-thread median than about the threads, though two threads may also have more cache to
work with than one. It reaches {{ms threaded t=4}} with four threads, and with eight it
takes {{ms threaded t=8}}: slightly slower, though the eight threads are all the machine's
hardware threads on {{env physical_cores}} physical cores.

At n = 1024, where the one-thread runs do not spread this way, level 1 roughly halves its
time with two threads ({{ms threaded t=1 n=1024}} to {{ms threaded t=2 n=1024}}) and still
gains a little from the second four ({{ms threaded t=4 n=1024}} to
{{ms threaded t=8 n=1024}}). One plausible reading of that last gain is that level 1's
inner loop spends much of its time waiting for memory, and a thread that is waiting leaves
its core free for the thread that shares it. The measurements at n = 1024 are consistent
with that and do not test it; those at n = {{env largest}} do not support it.

Levels 2, 3 and 4 behave differently. Level 3 takes {{ms simd t=1}} on one thread,
{{ms simd t=2}} on two and {{ms simd t=4}} on four, and then {{ms simd t=8}} on eight:
almost nothing from the second four threads. Level 4 is the same, {{ms streaming t=4}} on
four threads and {{ms streaming t=8}} on eight. Level 2 gains a little more from them
({{ms cache_friendly t=4}} to {{ms cache_friendly t=8}}), far less than from its first
four. For these three levels most of the scaling stops where the physical cores run out,
not where the hardware threads do.

The Methods say that threads stop helping when something they share is used up, such as
the memory system. The reference run also measured two limits of the machine directly,
natively and with the same thread counts. A bandwidth test (the STREAM triad, which streams
three arrays far larger than the caches) moved {{triad t=1}} on one thread,
{{triad t=4}} on four and {{triad t=8}} on eight: like the levels, it stops gaining at
four threads. An arithmetic test that never leaves the registers kept gaining:
{{peak t=1}} on one thread, {{peak t=4}} on four, {{peak t=8}} on eight. These are the rates
that one test loop achieved, not the most the cores can do. Level 3 reaches
{{frac simd t=1}} of the test's one-thread rate on one thread, and {{frac simd t=8}} of its
eight-thread rate on eight. So with eight threads the test found more arithmetic than the
levels use. That suggests the arithmetic units themselves are not what runs out, but it
does not show that main memory is. A rough count, not a measurement: level 4 at
n = {{env largest}} reads its input tiles about 1 GB worth in all, even if every tile came
from main memory, and at the triad's {{triad t=4}} that would take under a tenth of its
{{ms streaming t=4}} on four threads. That makes main-memory bandwidth look an unlikely
limit, for level 4 at least, but the count is an estimate and the triad is one access
pattern among many, so the data cannot rule it out. The other candidates are what two
hyper-threads of one core share besides the arithmetic: the L1 and the {{env l2}} L2
cache of that core, and the machinery that feeds the execution units. The run did not
measure those, and hardware counters would be needed to tell these explanations apart.

The throughput of the fastest levels also depends on the problem size, and here too the
change falls between n = 512 and n = 1024. Level 3 on four threads reaches
{{gflops simd t=4 n=512}} at n = 512, {{gflops simd t=4 n=1024}} at n = 1024 and
{{gflops simd t=4}} at n = {{env largest}}. On one thread it hardly changes:
{{gflops simd t=1 n=512}}, {{gflops simd t=1 n=1024}} and {{gflops simd t=1}}. The fall
therefore appears only when several threads run, and it comes where the three matrices outgrow the
{{env l3}} cache that all the cores share. That fits a reading in which several threads
competing for the shared cache, or for what lies behind it, set the pace, but the run did
not measure it.

Taken together, level 3 with {{env threads_native}} threads is {{speedup simd/naive}} faster
than the textbook loop at n = {{env largest}}, with the same answer. Level 4 on four
threads is faster still, {{speedup streaming/naive t=4}}, the fastest case measured at that
size. Both figures divide by level 0's uncertain median, so their exact size matters less
than their order of magnitude.

# What streaming costs, and what it did not

[Level 4](crate::streaming) exists to make the problem possible when the matrices do not
fit in memory, not to make it faster when they do, and the chapter says so. The reference
run measures it only on matrices that fit, and at the two largest sizes the cost one might
expect from copying tiles into buffers did not appear: level 4 was faster than level 3. At
n = {{env largest}}, level 4 takes {{ms streaming t=1}} on one thread against level 3's
{{ms simd t=1}}, {{ms streaming t=2}} on two against {{ms simd t=2}},
{{ms streaming t=4}} on four against {{ms simd t=4}}, and {{ms streaming t=8}} on eight
against {{ms simd t=8}}. At n = 1024 it is ahead at every thread count too, by less
({{ms streaming t=4 n=1024}} against {{ms simd t=4 n=1024}} on four threads). At the two
smaller sizes level 4 loses that lead: the two levels are close, level 4 sometimes ahead
and sometimes behind, but never more than about a tenth behind.

The reference run does not say why. One reading, untested here: level 4 copies each tile
into a small buffer of its own, so its inner loop walks short rows that lie next to each
other in memory, while level 3 works on the full matrices, whose rows lie n × 8 bytes
apart (16 KiB at n = 2048). Rows that far apart, at a power-of-two distance, may compete for
the same places in a cache, and a small buffer avoids that. Cache-miss counts would test
this reading; the run did not record them. What the run does show is narrower: on this
machine, at these sizes, the copies never made level 4 much slower than level 3, and at the
two largest sizes it was faster.

# Browser against native

At n = {{env largest}}, the same Rust code, compiled to WebAssembly and run in
{{env firefox}}, was slower than the native build at levels 2 to 4, by an amount that
depends on the level. On one thread, level 2 took {{ms cache_friendly lite}} in the browser's
single-threaded build against {{ms cache_friendly t=1}} natively, level 3 took
{{ms simd lite}} against {{ms simd t=1}}, and level 4 took {{ms streaming lite}} against
{{ms streaming t=1}}. Of these three, the level written around vector registers comes
closest to native speed. Both builds use 128-bit vectors,
{{env native_isa}} natively and {{env browser_isa}} in the browser, so the level 3
micro-kernel asks for the same width in both. That is a reason to expect it to travel well;
the experiment shows that it does, but not why the others lose more. Level 3 came closest
of the three at every size, and at n = 1024 the browser was even slightly faster
({{ms simd lite n=1024}} against {{ms simd t=1 n=1024}} natively).

Levels 0 and 1 are a different case. At n = {{env largest}} they were no slower in the
browser than natively: level 0 took {{ms naive lite}} against {{ms naive}}, level 1
{{ms threaded lite}} against {{ms threaded t=1}}. Those are the two native medians that rest
on spread runs, so the comparison is uncertain. At n = 1024, where the native
runs are not spread, both were slower in the browser: level 0 took {{ms naive lite n=1024}}
against {{ms naive n=1024}}, level 1 {{ms threaded lite n=1024}} against
{{ms threaded t=1 n=1024}}.

The gaps between the levels are therefore not the same in the two environments. Natively, at
this size, level 4 is faster than level 3. In the browser's single-threaded build it is slower, taking
{{ms streaming lite}} against level 3's {{ms simd lite}}. The reference run does not show why:
the tile copies, or another part of level 4's loop, may cost more in WebAssembly than they
do natively.

With threads, level 3 comes within about a tenth of native speed: it took {{ms simd threads}} in the
browser's threaded build ({{env threads_threaded}} threads), against {{ms simd}} natively
({{env threads_native}} threads). At n = {{env largest}} it also stops improving after four threads,
like the native build: {{ms simd threads t=4}} on four threads, {{ms simd threads t=8}} on
eight. The reference run does not say why the threaded build comes so close here.

The two browser builds differ in more than threads. The single-threaded build was compiled
with {{env rustc_lite}}, the threaded one, like the native code, with {{env rustc_threads}},
and only the threaded build uses shared memory. On one thread, at n = {{env largest}}, the
threaded build was faster than the single-threaded one for levels 0, 2 and 4
({{ms naive threads}} against {{ms naive lite}}, {{ms cache_friendly threads t=1}} against
{{ms cache_friendly lite}}, {{ms streaming threads t=1}} against {{ms streaming lite}}),
about the same for level 3 ({{ms simd threads t=1}} against {{ms simd lite}}), and much
slower for level 1 ({{ms threaded threads t=1}} against {{ms threaded lite}}), whose
one-thread runs in the threaded build varied widely. Which of the differences between the
builds causes which result is not something this experiment can separate.

# What the measurements cannot say

- **One machine, one day, one browser.** The reference run used {{env cpu}} with the CPU
  governor set to {{env governor}}, on {{env date}}, in {{env firefox}}. Its caches are
  {{env l1d}} of L1 data cache and {{env l2}} of L2 per core, and {{env l3}} of L3 shared
  by all the cores. Another CPU, with other cache sizes and another memory system, would
  give other ratios. The playground
  lets a reader repeat the browser measurements on their own machine.
- **Four sizes.** The sizes were {{env sizes}}. Trends with the size, such as the growing
  gain of cache blocking, rest on four points, each double the last, so a change of
  behaviour between two of them, such as the fall between n = 512 and n = 1024, cannot be
  placed more precisely. Nor does any of them separate the effect of the size from the
  effect of leaving one cache level for the next.
- **Baseline vectors, no fused multiply-add.** Native code was built for {{env native_isa}}
  (recorded RUSTFLAGS: {{env rustflags}}), the baseline of the platform and not of this CPU. By
  design no level uses fused multiply-add, which would change the result bits. Both choices
  keep the comparison honest and keep the results identical. They also mean that none of
  these figures is the most this CPU can do.
- **Explanations are interpretations.** The levels were timed, not profiled. The
  reference run recorded the cache sizes, a triad bandwidth ({{env triad_max}} at most) and
  the rate of an arithmetic test ({{env peak_max}} at most), but read no hardware counters: no cache
  misses, no memory traffic, no use of the execution units. Each statement above about why
  a difference arises is a reading consistent with the numbers, not a measurement of the
  cause.
- **Noise.** Cases whose interquartile range exceeds 20% of the median are marked † on the
  Results page and should be read as indicative. Browser timings in particular depend on
  the browser's clock and engine.
