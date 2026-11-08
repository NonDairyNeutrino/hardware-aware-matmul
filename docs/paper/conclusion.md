The case began with one question: why does the textbook matrix product use so little of what
the core can do, when a version with the same arithmetic is so much faster? The answer is
mostly in how the work meets memory, and partly still open.

# The suspects

The [Introduction](crate::introduction) set the rule of the case: six implementations of the
same product, each computing the same result bit for bit, so that nothing but the use of the
hardware can explain a difference. The Methods then tried one suspect at a time:

- [Level 1](crate::threaded) splits the output rows across threads.
- [Level 2](crate::cache_friendly) reorders the loops and blocks them for the cache.
- [Level 3](crate::simd) keeps a block of the output in vector registers.
- [Level 4](crate::packed) copies each block of the second matrix into a contiguous buffer
  before the vector kernel reads it.
- [Level 5](crate::streaming) streams tiles of the matrices through small buffers, so that
  the problem no longer has to fit in memory.

Each is a small change to the previous level, written in safe Rust without dependencies,
and each chapter says what it fixes and what it still costs.

# The verdict

The cores were not the main cause: at the largest size, the cache-friendly level on one
thread beat the simplest threaded level at every thread count. Most of the one-thread gain
came from reordering the loops and blocking for the cache, the vector kernel then took a
smaller step, the packed copy helped further at the two largest sizes, and streaming, built
for a different reason, was the fastest case measured, natively at the largest size on four
threads.

In the reference run every case returned the same result, whatever the level, the thread count or the environment. At n = {{env largest}}, natively, level 3 with all of its threads was {{speedup simd/naive}}
faster than the textbook loop, and level 5 on four threads {{speedup streaming/naive t=4}}.
On one thread, most of the gain arrived with level 2, which
reorders the loops and blocks for the cache ({{speedup cache_friendly/naive t=1}}); the
vector micro-kernel added a further {{speedup simd/cache_friendly t=1}}. Threads helped the
blocked, vector and streaming levels until the physical cores ran out, and little beyond.
Level 4, which copies each block of the second matrix first, was no faster than level 3 at
the two smaller sizes and faster at every thread count at the two largest. Level 5, built for
matrices that do not fit in memory, was likewise about as fast as level 3 on matrices that do
at the two smaller sizes and faster at the two largest, and level 4 recovered most of that
lead. Counting events on one thread, level 4 had {{countratio l1d_misses simd/packed n=1024}} fewer
L1 misses than level 3 at n = 1024 and took about the same cycles; at the largest size it had
{{countratio l1d_misses simd/packed}} fewer, sent far fewer loads past the L2, and took
{{countratio cycles simd/packed}} fewer cycles, in step with its shorter time. In the browser, at the
largest size, the single-threaded build ran more slowly than native code at levels 2 to 5, by
an amount that depended on the level; levels 3 and 4, which are written around vector
registers, came closest, level 3 at {{gflops simd lite}} against {{gflops simd t=1}} natively.
Levels 0 and 1 ran about as fast in the browser as natively at the largest size.

# What it means, and what it does not

The lesson of the measurements is the one the project set out to show: with the arithmetic
unchanged, the way the work is laid out over memory, registers and cores moved the running
time by more than an order of magnitude. It is also the lesson of the limits. The figures
come from one machine on one day, the explanations are mostly readings of the numbers (the
event counts, from one size and one thread, test only some of them), and none of the levels is a replacement for a tuned linear
algebra library. The [playground](crate::playground) is there so that a reader can run the
comparison on their own hardware, and see whether the same shape appears.

One question is left open, and it is the one to take away from the case. Threads stopped
helping levels 3 to 5 where the physical cores ran out, while a test of arithmetic alone kept
gaining. A rough count of level 5's reads from main memory made main-memory bandwidth look an
unlikely limit for that level, but the count is an estimate, and the data cannot settle it.
What the cores share besides the arithmetic (their caches, the machinery that feeds the
execution units) was not measured. The [playground](crate::playground) lets a reader see
whether the same shape appears on their own machine.

# Four questions to take with you

The [primer](crate::primer) listed four questions, and the levels answer them one after
another. They are the part of this paper that is not specific to matrix multiplication:

1. **Is the access contiguous?** Does the code use every byte of the cache lines it fetches,
   or does it jump over data? (The reordered loops of level 2, the packed strips of level 4.)
2. **What is reused, and how far apart are the uses?** Does a value stay in a fast memory
   until it is used again? (The blocks of level 2, the register block of level 3.)
3. **How many bytes move per operation?** Is that more than the memory bandwidth of the
   machine can supply? (The register block of level 3 cuts the loads and stores of the inner loop.)
4. **Is there independent work for every core and every lane?** (The row blocks of level 1,
   the vector lanes of level 3.)

Asking them of a loop before measuring it tells you where to look. Measuring it afterwards
tells you whether you were right, as the Discussion tried to do for these six levels.

# Beyond matrix multiplication

The same questions apply wherever code moves a lot of data. A stencil or a convolution
reuses neighbouring elements, so it asks question 2. A program that stores its records as an
array of structures and reads one field of each walks memory with a stride, which is
question 1; storing each field in its own array makes the walk contiguous. A transpose
writes with a stride however it reads. A scan over a column of a large table is
question 3. An aggregation over more data than fits in memory is the situation level 5
was built for.

# Further reading

- Ulrich Drepper, *What Every Programmer Should Know About Memory* (2007): the memory
  hierarchy in depth.
- Kazushige Goto and Robert van de Geijn, *Anatomy of High-Performance Matrix
  Multiplication*, ACM Transactions on Mathematical Software 34(3), 2008: how production
  libraries multiply matrices, including the packing and register blocking. This project
  does both for the second matrix and the output, and leaves the first matrix unpacked.
- Samuel Williams, Andrew Waterman and David Patterson, *Roofline: An Insightful Visual
  Performance Model for Multicore Architectures*, Communications of the ACM 52(4), 2009: a
  way to predict whether a loop is limited by memory or by arithmetic.
