Multiplying two {{env largest}} × {{env largest}} matrices takes {{env madds}} multiply-adds.
On the laptop used for this paper, the textbook way to do it, three nested loops, takes
{{ms naive}}. A version that does exactly the same multiply-adds, spread over all {{env threads_native}}
hardware threads ({{env physical_cores}} physical cores, each running two; the [primer](crate::primer) explains), takes {{ms simd}}, which is {{speedup simd/naive}} faster, on the same
laptop, and returns the same answer, bit for bit.

Nothing clever happened to the arithmetic. No multiplication was skipped, no addition was
reordered, and nobody found a better algorithm. The whole difference is in *how the work was
laid out over the hardware*: which core does which part, in what order the memory is
touched, what is kept close to the arithmetic units, and, for matrices too big for memory, what is
never held all at once. This
paper is about that difference. Matrix multiplication is only the worked example.

# Mechanical sympathy

The phrase comes from motor racing, where it is credited to the driver Jackie Stewart and
means driving with an understanding of how the machine works. The engineer Martin Thompson
popularised it in software. A processor is not an abstract machine that executes your loops
one step at a time. It has several cores, a hierarchy of memories that differ enormously in
speed (small, fast caches between the cores and the main memory), and vector units that do
several operations at once. Code that is written with those in mind can run many times faster than
code that computes the same thing without them. That is the lesson here, and the matrix
product is a good place to learn it because the algorithm fits in four lines, so nothing
distracts from the hardware.

# Why memory use matters more than core count

The most surprising number in this paper is not the total speedup but where it comes from.
On one thread, level 2 (the cache-friendly version, described below) needs
{{ms cache_friendly t=1}}, against {{ms naive}} for the textbook loop. That is faster than
eight threads of level 1, the first threaded version ({{ms threaded t=8}}), which uses every
hardware thread the machine has. Reorganising how one thread uses memory beat adding
threads. The Methods give the likely reason, and the [Discussion](crate::discussion) says
how far the measurements support it.

# The five levels

Each level changes one thing about how the hardware is used, and removes the bottleneck the
previous level ran into. Every level returns exactly the same bits as the one before. The times are for
{{env largest}} × {{env largest}} matrices.

| Level | The bottleneck it removes | The idea | Time, 1 thread | Time, {{env threads_native}} threads |
|-------|---------------------------|----------|----------------|---------------------|
| [0](crate::naive) | (the baseline: one core, and reads of the second matrix in a poor order) | the textbook triple loop | {{ms naive}} | not parallel |
| [1](crate::threaded) | the other cores sit idle | split the output rows across threads | {{ms threaded t=1}} | {{ms threaded}} |
| [2](crate::cache_friendly) | reading memory in an order the hardware handles badly, and re-fetching data | reorder the loops and work on small blocks that stay in the cache | {{ms cache_friendly t=1}} | {{ms cache_friendly}} |
| [3](crate::simd) | the output block travelling through memory on every step | keep a block of the output in vector registers | {{ms simd t=1}} | {{ms simd}} |
| [4](crate::streaming) | the need for every matrix to fit in memory | stream small tiles of the matrices through bounded buffers | {{ms streaming t=1}} | {{ms streaming}} |

Level 4 is a different kind of step. It does not aim to be faster on matrices that fit in
memory; it makes the problem possible on matrices that do not. The Discussion measures what
that costs.

# How to read this

The site is laid out like a paper, in the order a paper is read: this Introduction, then the
Methods, one chapter per level, then the [Results](crate::results), the
[Discussion](crate::discussion) and the [Conclusion](crate::conclusion). A short
[primer](crate::primer) comes before the Methods and introduces the few hardware ideas the
chapters use. Each Methods chapter after the first starts from the bottleneck the previous
level left and shows the change that removes it, and levels 1 to 4 have a diagram you can step
through. The Results are measurements of the five levels, natively and in a web browser, on one
machine; the Discussion compares them and says what they do and do not show. The
[playground](crate::playground) runs the same benchmark on your own machine.

You can also jump straight to a chapter. Each opens by saying what it changes, and closes with
what it costs and where to go next. The code is real Rust: the diagrams are driven by it and so
are the measurements. It is written in plain loops so that each level reads like the loop nest
it is.

# What this is not

This is not a linear algebra library, and it is not about better algorithms. Methods such as
Strassen's reduce the number of multiplications; none of the levels here does, and the
arithmetic never changes. The code is deliberately short, safe and untuned, so that you can
read all of it. If you need a fast matrix product for real work, use a tuned library. The
[source](https://github.com/NonDairyNeutrino/hardware-aware-matmul) has the instructions for
running the code yourself.
