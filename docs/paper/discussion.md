The [Results](crate::results) report what was measured; this page weighs it. The question from
the [Introduction](crate::introduction) was where the time of the textbook loop goes, and the
sections below take the suspects in the order the evidence clears or convicts them: the cores,
the memory system, the registers and the copy, the twist at level 5, and the one question that
stays open. Everything below refers to the reference run: one laptop, one day, one browser.
Every figure is filled in from that run's committed data. Where a sentence explains a
difference rather than reports it, the sentence says so, and where the data cannot tell two
explanations apart, the page says that too.

# The answer does not change

All {{env runs}} measured cases produced the same result for each matrix size, bit for
bit: every level, every thread count, natively and in both browser builds. That is the
premise of the comparison, and it is what separates it from a comparison of algorithms. No
level does fewer multiply-adds than another, or different ones: each output element is
still the sum of the same products, added in the same order. Every difference below is therefore a difference in how well the same
arithmetic was fed to the hardware, and none of the speed was bought with a different
answer.

# The first suspect: the cores

The obvious explanation is that the textbook loop leaves most of the cores idle. The
measurements clear it, or at least show it is not the main cause.

Level 1 on one thread ({{ms threaded t=1}}) is no faster than level 0
({{speedup threaded/naive t=1}}), as it should be: [threads](crate::threaded) change
nothing until there is more than one of them.

Neither figure is noise: at n = {{env largest}} level 1's {{ms threaded t=1}} on one thread
and level 0's {{ms naive}} come from {{env repeats}} runs each, all within a few per cent of
their median. With two threads it takes {{ms threaded t=2}}, about half, and with
four {{ms threaded t=4}}. With eight it takes {{ms threaded t=8}}: no slower, and less than a
tenth faster, though the eight threads are all the machine's hardware threads on
{{env physical_cores}} physical cores.

At n = 1024 level 1 also roughly halves its time with two threads
({{ms threaded t=1 n=1024}} to {{ms threaded t=2 n=1024}}) and gains a little more from the
second four ({{ms threaded t=4 n=1024}} to {{ms threaded t=8 n=1024}}). One plausible reading
of that last gain is that level 1's inner loop spends much of its time waiting for memory,
and a thread that is waiting leaves its core free for the thread that shares it. The
measurements at n = 1024 are consistent with that and do not test it; those at
n = {{env largest}} do not support it. And at n = {{env largest}} none of it comes close to
[level 2](crate::cache_friendly) on a single thread: {{ms cache_friendly t=1}}, against
level 1's {{ms threaded t=8}} on all eight threads. More cores were not the main thing the
loop was missing.

# The culprit: memory

The best explanation of the rest is the memory system, with the caveat that the run measured
its caches directly only at two sizes.

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
same places in a cache. Cache-miss counts bear on this, though only at two sizes: the counting
run (see [What the counters show](#what-the-counters-show) below) found, at n = 1024,
that the naive loop missed the L1 data cache on {{count l1d_miss_rate naive n=1024}} of its loads and level 2 on
{{count l1d_miss_rate cache_friendly n=1024}}, and sent {{count llc_loads naive n=1024}} loads on to the
last-level cache against level 2's {{count llc_loads cache_friendly n=1024}}. That fits the memory
system as the cause. At n = {{env counters_n}} the naive loop's loads that reach the last-level cache and
miss it number {{count llc_misses naive}}, against level 2's {{count llc_misses cache_friendly}}: the
naive walk goes to main memory. The counts were taken at two sizes, neither of them between
n = 512 and n = 1024, so they cannot say which of the two changes there matters.

# Cleaning up: registers and packing

Two smaller changes follow, each removing a cost the previous level still paid.

Level 3's gain over level 2 is much smaller, though its micro-kernel
[keeps a block of the output in vector registers](crate::simd). The experiment does not
show how much of level 2's speed already comes from the compiler vectorising its inner
loop, which would need the generated assembly, so it cannot say how much of the possible
gain level 3 captures.

[Level 4](crate::packed) adds a copy to level 3: each block of the second matrix is moved
into a contiguous buffer before the vector kernel reads it. At the two largest sizes the cost
one might expect did not appear: level 4 was faster than level 3 at every thread count. At
n = {{env largest}}, level 4 takes {{ms packed t=1}} on one thread against level 3's
{{ms simd t=1}}, {{ms packed t=2}} on two against {{ms simd t=2}}, {{ms packed t=4}} on four
against {{ms simd t=4}}, and {{ms packed t=8}} on eight against {{ms simd t=8}}. At n = 1024
the lead is much smaller ({{ms packed t=4 n=1024}} against {{ms simd t=4 n=1024}} on four
threads), and at the two smaller sizes the two levels are within a tenth of each other,
neither always ahead.

# What the counters show

A separate run counted hardware events (with `perf stat`) for one multiplication per level on
one thread, at n = 1024 and at n = {{env counters_n}}, user-space events only, in a binary built
with the same compiler as the timed runs. The two sizes give different answers.

At n = 1024, level 4 had {{count l1d_misses packed n=1024}} L1 data-cache misses against level 3's
{{count l1d_misses simd n=1024}}, {{countratio l1d_misses simd/packed n=1024}} fewer. Its cycle
count did not follow: {{count cycles packed n=1024}} against {{count cycles simd n=1024}}, at about the same
instructions per cycle ({{count ipc packed n=1024}} against {{count ipc simd n=1024}}). That matches the
timings at that size, where level 4 is only slightly ahead. One reading is that the misses of
level 3 were served from the L2 cache and overlapped with arithmetic by the processor running
ahead, so removing them freed no time; the counts do not test that.

At n = {{env counters_n}} the same removal pays. Level 4 had {{count l1d_misses packed}} L1 misses against
level 3's {{count l1d_misses simd}}, {{countratio l1d_misses simd/packed}} fewer, and it sent
{{count llc_loads packed}} loads on to the last-level cache against level 3's
{{count llc_loads simd}}: the strided reads of the second matrix had stopped being caught by the L2.
Its cycles fell with them, {{count cycles packed}} against {{count cycles simd}}, by about the
fraction by which its one-thread time was shorter ({{ms packed t=1}} against {{ms simd t=1}}), and its
instructions per cycle rose from {{count ipc simd}} to {{count ipc packed}}. So on one thread the faster time
comes with fewer cycles and fewer loads that left the L2, which is what the reading that the
cost lies in reading the second matrix in place predicted. This is the strongest evidence in this paper for a
cause, and it still has limits: it is one thread, and it shows that the misses went away and the cycles went with them, not
that the misses were the whole of the saving.

Level 5 goes further at that size: {{count cycles streaming}} cycles, {{count ipc streaming}} instructions per cycle, and
{{count llc_loads streaming}} loads sent to the last-level cache. It executes more L1 loads than level 4
({{count l1d_loads streaming}} against {{count l1d_loads packed}}), because its kernel is level 2's
rather than the register-blocked one, so it does more work and spends less time waiting. The
cycles order levels 3, 4 and 5 as the times do (level 5's times follow in the twist below). The step from level 4 to level 5 is therefore a
step in waiting for memory, not in instructions.

Both levels 3 and 4 counted only a few thousand to a few tens of thousands of data-TLB misses
at either size, so a TLB effect, which the chapter on level 4 lists as a possible gain, does not
show here.

Two limits matter. The counts are from one thread, so they say nothing about why the gains
shrink with more threads. And one count is not explained: level 1 on one thread counted about
twice as many L1 data-cache loads as level 0 at both sizes ({{count l1d_loads threaded}} against
{{count l1d_loads naive}} at n = {{env counters_n}}), though the two run the same loop in the same time. The L1 counts
of those two levels should not be over-read.

# The twist: streaming

Level 5 was built for matrices that do not fit in memory, not for speed, and on four threads
at the largest size it is nonetheless the fastest case measured.

[Level 5](crate::streaming) exists to make the problem possible when the matrices do not
fit in memory, not to make it faster when they do, and the chapter says so. The reference
run measures it only on matrices that fit. It copies tiles into buffers, and at the two
largest sizes it was faster than level 3 at every thread count, as level 4 was. At n = {{env largest}}
it takes {{ms streaming t=1}} on one thread, {{ms streaming t=2}} on two,
{{ms streaming t=4}} on four and {{ms streaming t=8}} on eight, each ahead of level 4's time
with the same threads, though by little: level 4 gets most of the way from level 3 to level 5
at every thread count. At the two smaller sizes level 5 loses the lead: it is close to
level 3, sometimes ahead and sometimes behind, but never more than about a tenth behind.

Level 4 also helps explain the twist. One reading offered for level 5's lead was that its
small buffers hold short rows that lie next to each other in memory, while level 3 works on
the full matrices, whose rows lie n × 8 bytes apart
(16 KiB at n = 2048), and rows that far apart, at a power-of-two distance, may compete for the
same places in a cache. Level 4 copies only the second matrix, in blocks, and keeps level 3's
loops otherwise, and it recovers most of the lead. That is evidence that the way the second
matrix is read in place is most of what level 5 avoids at these sizes, because a change that
touches nothing else gets most of the gain. The counts above agree: packing sends far fewer loads past the L2, and
the cycles fall. They do not show that cache-set conflicts are the mechanism. The strided reads
also touch more cache lines and more pages for the same data, and the run cannot separate
those effects. A smaller part of level 5's lead, the step from level 4
to level 5, is still not explained: the counts above show less waiting for memory, not why.

Measured against the textbook loop at n = {{env largest}}, level 3 with
{{env threads_native}} threads is {{speedup simd/naive}} faster, with the same answer, and
level 5 on four threads {{speedup streaming/naive t=4}}. Both figures divide by the median of
level 0's one-thread runs, which agreed to within an interquartile range of {{iqr naive}}.

# Browser against native

At n = {{env largest}}, the same Rust code, compiled to WebAssembly and run in
{{env firefox}}, was slower than the native build at levels 2 to 5, by an amount that
depends on the level. On one thread, level 2 took {{ms cache_friendly lite}} in the browser's
single-threaded build against {{ms cache_friendly t=1}} natively, level 3 took
{{ms simd lite}} against {{ms simd t=1}}, level 4 took {{ms packed lite}} against
{{ms packed t=1}}, and level 5 took {{ms streaming lite}} against {{ms streaming t=1}}. The
two levels written around vector registers, 3 and 4, come closest to native speed. Both
builds use 128-bit vectors, {{env native_isa}} natively and {{env browser_isa}} in the
browser, so the micro-kernel of levels 3 and 4 asks for the same width in both. That is a
reason to expect them to travel well; the experiment shows that they do, but not why levels 2
and 5 lose more. Levels 3 and 4 came closest of the four at every size.

Levels 0 and 1 are a different case. At n = {{env largest}} they ran about as fast in the
browser as natively: level 0 took {{ms naive lite}} against {{ms naive}}, level 1
{{ms threaded lite}} against {{ms threaded t=1}}. At n = 1024 both were much slower in the
browser: level 0 took {{ms naive lite n=1024}} against {{ms naive n=1024}}, level 1
{{ms threaded lite n=1024}} against {{ms threaded t=1 n=1024}}. The run does not show why the
gap closes at the largest size.

The gaps between the levels are therefore not the same in the two environments. Natively, at
this size, levels 4 and 5 are both faster than level 3. In the browser's single-threaded
build level 4 is still ahead of level 3 ({{ms packed lite}} against {{ms simd lite}}), but
level 5 is far behind, taking {{ms streaming lite}}. The reference run does not show why:
copying blocks of the second matrix seems to cost little in WebAssembly, while the tile
copies, or another part of level 5's loop, may cost more there than they do natively.

With threads, level 3 comes within about an eighth of native speed: it took {{ms simd threads}} in the
browser's threaded build ({{env threads_threaded}} threads), against {{ms simd}} natively
({{env threads_native}} threads). At n = {{env largest}} it also stops improving after four threads,
like the native build (see the next section): {{ms simd threads t=4}} on four threads,
{{ms simd threads t=8}} on eight. The reference run does not say why the threaded build comes so close here.

The two browser builds differ in more than threads. The single-threaded build was compiled
with {{env rustc_lite}}, the threaded one, like the native code, with {{env rustc_threads}},
and only the threaded build uses shared memory. On one thread, at n = {{env largest}}, the
threaded build was faster than the single-threaded one for levels 0, 2, 4 and 5
({{ms naive threads}} against {{ms naive lite}}, {{ms cache_friendly threads t=1}} against
{{ms cache_friendly lite}}, {{ms packed threads t=1}} against {{ms packed lite}},
{{ms streaming threads t=1}} against {{ms streaming lite}}), and about the same for levels 1
and 3 ({{ms threaded threads t=1}} against {{ms threaded lite}}, {{ms simd threads t=1}}
against {{ms simd lite}}). Which of the differences between the
builds causes which result is not something this experiment can separate.

# The part left open: what stops the threads

One question is not settled by these measurements, and it is the most interesting one:
threads stopped helping levels 3 to 5 where the physical cores ran out, although a test of
arithmetic alone kept gaining.

Levels 2 to 5 behave differently from level 1. Level 3 takes {{ms simd t=1}} on one thread,
{{ms simd t=2}} on two and {{ms simd t=4}} on four, and then {{ms simd t=8}} on eight:
almost nothing from the second four threads. Levels 4 and 5 are the same, level 4 taking
{{ms packed t=4}} on four threads and {{ms packed t=8}} on eight, level 5 {{ms streaming t=4}} and
{{ms streaming t=8}}. Level 2 gains a little more from them
({{ms cache_friendly t=4}} to {{ms cache_friendly t=8}}), far less than from its first
four. For these four levels most of the scaling stops where the physical cores run out,
not where the hardware threads do.

The Methods say that threads stop helping when something they share is used up, such as
the memory system. The reference run also measured two rates of the machine directly,
natively and with the same thread counts. A bandwidth test (the STREAM triad, which streams
three arrays far larger than the caches) moved {{triad t=1}} on one thread,
{{triad t=4}} on four and {{triad t=8}} on eight: like the levels, it stops gaining at
four threads. An arithmetic test that never leaves the registers kept gaining:
{{peak t=1}} on one thread, {{peak t=4}} on four, {{peak t=8}} on eight. These are the rates
that one test loop achieved, not the most the cores can do. Level 3 reaches
{{frac simd t=1}} of the test's one-thread rate on one thread, and {{frac simd t=8}} of its
eight-thread rate on eight. So with eight threads the test found more arithmetic than the
levels use. That suggests the arithmetic units themselves are not what runs out, but it
does not show that main memory is. A rough count, not a measurement: level 5 at
n = {{env largest}} reads its input tiles about 1 GB worth in all, even if every tile came
from main memory, and at the triad's {{triad t=4}} that would take under a tenth of its
{{ms streaming t=4}} on four threads. That makes main-memory bandwidth look an unlikely
limit, for level 5 at least, but the count is an estimate and the triad is one access
pattern among many, so the data cannot rule it out. The other candidates are what two
hyper-threads of one core share besides the arithmetic: the L1 and the {{env l2}} L2
cache of that core, and the machinery that feeds the execution units. The run did not
measure those. The counting run above used one thread, so it cannot tell these explanations
apart either.

The throughput of the fastest levels also depends on the problem size, and here too the
change falls between n = 512 and n = 1024. Level 3 on four threads reaches
{{gflops simd t=4 n=512}} at n = 512, {{gflops simd t=4 n=1024}} at n = 1024 and
{{gflops simd t=4}} at n = {{env largest}}. On one thread it hardly changes:
{{gflops simd t=1 n=512}}, {{gflops simd t=1 n=1024}} and {{gflops simd t=1}}: it falls too,
but much less. The fall is therefore mostly a fall with several threads, and it comes where the
three matrices outgrow the {{env l3}} cache that all the cores share. That fits a reading in
which several threads competing for the shared cache, or for what lies behind it, set the
pace, but the run did not measure it. The one-thread fall that remains is the part that
packing removes: level 4 on one thread reaches {{gflops packed t=1 n=512}} at n = 512 and
{{gflops packed t=1}} at n = {{env largest}}, a smaller fall than level 3's.

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
- **Explanations are interpretations.** The levels were timed, and counted at two sizes on one
  thread. The reference run recorded the cache sizes, a triad bandwidth ({{env triad_max}} at
  most), the rate of an arithmetic test ({{env peak_max}} at most) and, at n = 1024 and
  n = {{env counters_n}} on {{env counters_threads}} thread, cycles, instructions and misses in the L1, the last-level
  cache and the data TLB. It did not count memory traffic, the use of the execution units,
  anything with several threads running, or anything in the browser. Each statement above about
  why a difference arises is a reading consistent with the numbers, not a measurement of the
  cause.
- **Noise.** Cases whose interquartile range exceeds 20% of the median are marked † on the
  Results page and should be read as indicative. Browser timings in particular depend on
  the browser's clock and engine.
