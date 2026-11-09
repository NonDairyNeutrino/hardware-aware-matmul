# A minute or a second

Multiplying two {{env largest}} × {{env largest}} matrices takes {{env madds}} multiply-adds. On
the laptop used for this paper, the textbook way to do it, three nested loops, takes
{{ms naive}}. A version that performs exactly the same multiply-adds takes {{ms streaming t=4}}.

No multiplication was skipped, no sum was reordered, and nobody found a better algorithm: every
version here returns the same answer, bit for bit. So the difference lies in *how the work meets the
hardware*: which core does which part, the order memory is touched, what stays near the arithmetic,
and, for matrices too big for memory, what is never held at once.

# How much of the core was the loop using?

Start with what the machine can do. A short test loop that does nothing but multiplications and
additions, and hardly touches memory, reaches {{peak t=1}} on one core of this laptop. (It uses no
fused multiply-add and only 128-bit vectors, so it is a yardstick, not the most the core could do.)
The textbook loop reaches {{gflops naive}}, which is {{frac naive t=1}} of that. The core can
multiply and add far faster than the textbook loop lets it, so the loop is not short of arithmetic.
It is short of something else.

# The obvious suspect

The textbook loop runs on one core, and this laptop has {{env physical_cores}} physical cores that
offer {{env threads_native}} hardware threads (the [primer](crate::primer) explains the
difference). So the first thing to try is the obvious one: split the work across threads.
[Level 1](crate::threaded) does that, and with all {{env threads_native}} threads it takes
{{ms threaded t=8}}. Four threads took {{ms threaded t=4}}, so the second four bought almost nothing.

Then comes the clue that gives the paper its shape. [Level 2](crate::cache_friendly) changes only
the order in which one thread walks memory, and takes {{ms cache_friendly t=1}} on a *single*
thread. That is faster than the threaded version on every thread the machine has. More cores were
not the main thing the loop was missing.

# Mechanical sympathy

The phrase comes from motor racing, where it means driving with an understanding of how the machine
works. Here the machine is a processor, with its cores, its caches and its vector units. The rest of
the paper is a search for which of those the textbook loop was ignoring, and what it costs to stop
ignoring each one. The matrix product is a good place to search because the algorithm fits in four
lines, so nothing distracts from the hardware.

# The line-up

Each level changes one thing, aimed at the bottleneck the previous level hit.

| Level | The bottleneck it targets | The idea |
|-------|---------------------------|----------|
| [Level 0](crate::naive) | (the baseline: one core, and reads of the second matrix in a poor order) | the textbook triple loop |
| [Level 1](crate::threaded) | the other cores sit idle | split the output rows across threads |
| [Level 2](crate::cache_friendly) | reading memory in an order the hardware handles badly, and re-fetching data | reorder the loops and work on small blocks that stay in the cache |
| [Level 3](crate::simd) | the output block travelling through memory on every step | keep a block of the output in vector registers |
| [Level 4](crate::packed) | the kernel reads the second matrix a row apart, so each step hits a new cache line and, for long rows, a new page | copy each block of the second matrix into a contiguous buffer first |
| [Level 5](crate::streaming) | the need for every matrix to fit in memory | stream small tiles of the matrices through bounded buffers |

Level 5 is a different kind of step. It was built so that matrices too large for memory can be
multiplied at all, not to be faster on matrices that fit. On four threads it is the version that
opened this page; the [Discussion](crate::discussion) returns to why.

# How to read this

Read the levels in order: each [Methods](crate::naive) chapter opens with the clue the previous
level left behind and closes with what its own fix did not cure. A short [primer](crate::primer)
comes first and introduces the few hardware ideas the chapters use. Levels 1, 2, 3 and 5 have a
diagram you can step through, and levels 2, 3 and 4 have a figure that counts what the change saves.
The [playground](crate::playground) runs the same benchmark on your own machine.

Short on time? Read this page, then [level 2](crate::cache_friendly), where most of the
one-thread gain arrives, then the summary at the top of the [Discussion](crate::discussion)
and the [Conclusion](crate::conclusion). That is about twenty minutes.

This is not a linear algebra library. Methods such as Strassen's reduce the number of
multiplications; none of the levels here does. The code is real Rust, deliberately short, safe and
untuned, so that you can read all of it; the diagrams are driven by it and so are the measurements.
If you need a fast matrix product for real work, use a tuned library. The
[source](https://github.com/NonDairyNeutrino/hardware-aware-matmul) has the instructions for running
the code yourself.
