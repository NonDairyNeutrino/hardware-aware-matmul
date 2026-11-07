This project asked how much of a program's speed is a matter of how the hardware is
used, with the arithmetic held fixed. Dense matrix multiplication was the worked example,
chosen because the algorithm is easy to state and its performance is not.

# What was done

The [Introduction](crate::introduction) set the rule: five implementations of the same
product, each computing the same result bit for bit, so that nothing but the use of the
hardware can explain a difference. The Methods then added one idea at a time:

- [Level 1](crate::threaded) splits the output rows across threads.
- [Level 2](crate::cache_friendly) reorders the loops and blocks them for the cache.
- [Level 3](crate::simd) keeps a block of the output in vector registers.
- [Level 4](crate::streaming) streams tiles of the matrices through small buffers, so that
  the problem no longer has to fit in memory.

Each is a small change to the previous level, written in safe Rust without dependencies,
and each chapter says what it fixes and what it still costs.

# What was found

The [Results](crate::results) timed every level, natively and in a web browser, on one
machine, and the [Discussion](crate::discussion) compared them. In that run every case
returned the same result, whatever the level, the thread count or the environment. At n = {{env largest}}, natively, level 3 with all of its threads was {{speedup simd/naive}}
faster than the textbook loop. On one thread, most of the gain arrived with level 2, which
reorders the loops and blocks for the cache ({{speedup cache_friendly/naive t=1}}); the
vector micro-kernel added a further {{speedup simd/cache_friendly t=1}}. Threads helped the
blocked, vector and streaming levels until the physical cores ran out, and not beyond.
Level 4 cost little on matrices that fit in memory. In the browser, the single-threaded
build ran more slowly than native code at every level, by an amount that depended on the
level; level 3, which is written around vector registers, came closest, at
{{gflops simd lite}} against {{gflops simd t=1}} natively.

# What it means, and what it does not

The lesson of the measurements is the one the project set out to show: with the arithmetic
unchanged, the way the work is laid out over memory, registers and cores moved the running
time by more than an order of magnitude. It is also the lesson of the limits. The figures
come from one machine on one day, the explanations are readings of the numbers rather than
measurements of their causes, and none of the levels is a replacement for a tuned linear
algebra library. The [playground](crate::playground) is there so that a reader can run the
comparison on their own hardware, and see whether the same shape appears.
