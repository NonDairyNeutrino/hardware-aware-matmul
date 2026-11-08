Multiplying two {{env largest}} × {{env largest}} matrices takes {{env madds}} multiply-adds.
On the laptop used for this paper, the textbook way to do it, three nested loops, takes
{{ms naive}}. A version that does exactly the same multiply-adds, spread over all {{env threads_native}}
hardware threads ({{env physical_cores}} physical cores, each running two; the [primer](crate::primer) explains), takes {{ms simd}}, which is {{speedup simd/naive}} faster, on the same
laptop, and returns the same answer, bit for bit.

Nothing clever happened to the arithmetic. No multiplication was skipped, no sum was
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

# Where the speedup comes from

The most surprising number in this paper is not the total speedup but where it comes from.
On one thread, level 2 (the cache-friendly version, described below) needs
{{ms cache_friendly t=1}}, against {{ms naive}} for the textbook loop. That is faster than
eight threads of level 1, the first threaded version ({{ms threaded t=8}}), which uses every
hardware thread the machine has. Level 2 makes two changes at once, the loop order and
cache blocking, and the run cannot separate them from other effects. The Methods give the
likely reasons, and the [Discussion](crate::discussion) says how far the measurements
support each.

# The six levels

Each level changes how the hardware is used in one main way, and targets the bottleneck the
previous level ran into. Every level returns exactly the same bits as the one before. The times are for
{{env largest}} × {{env largest}} matrices.

| Level | The bottleneck it targets | The idea | Time, 1 thread | Time, {{env threads_native}} threads |
|-------|---------------------------|----------|----------------|---------------------|
| [Level 0](crate::naive) | (the baseline: one core, and reads of the second matrix in a poor order) | the textbook triple loop | {{ms naive}} | not parallel |
| [Level 1](crate::threaded) | the other cores sit idle | split the output rows across threads | {{ms threaded t=1}} | {{ms threaded}} |
| [Level 2](crate::cache_friendly) | reading memory in an order the hardware handles badly, and re-fetching data | reorder the loops and work on small blocks that stay in the cache | {{ms cache_friendly t=1}} | {{ms cache_friendly}} |
| [Level 3](crate::simd) | the output block travelling through memory on every step | keep a block of the output in vector registers | {{ms simd t=1}} | {{ms simd}} |
| [Level 4](crate::packed) | the vector kernel reading the second matrix in place, a row apart, so that each step lands on a different cache line and, with a long row, a different page | copy each block of the second matrix into a contiguous buffer first | {{ms packed t=1}} | {{ms packed}} |
| [Level 5](crate::streaming) | the need for every matrix to fit in memory | stream small tiles of the matrices through bounded buffers | {{ms streaming t=1}} | {{ms streaming}} |

Level 5 is a different kind of step. It does not aim to be faster on matrices that fit in
memory; it makes the problem possible on matrices that do not. On the reference machine it
was nonetheless faster than level 3 at the two largest sizes; the Discussion compares the
two on matrices that fit and says what is and is not known about why.

# How to read this

The site is laid out like a paper, in the order a paper is read: this Introduction, then the
Methods, one chapter per level, then the [Results](crate::results), the
[Discussion](crate::discussion) and the [Conclusion](crate::conclusion). A short
[primer](crate::primer) comes before the Methods and introduces the few hardware ideas the
chapters use. Each Methods chapter after the first starts from the bottleneck the previous
level left and shows the change that removes it. Levels 1, 2, 3 and 5 have a diagram you can step
through, and levels 2, 3 and 4 have a figure that counts what the change saves. The Results are measurements of the six levels, natively and in a web browser, on one
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
