# Abstract

Multiplying two {{env largest}} × {{env largest}} matrices takes {{ms naive}} when it is
written as the textbook three nested loops, on the laptop used for this paper, and
{{ms streaming t=4}} when it is written another way. Both versions perform exactly the same
multiply-adds, in the same order, and return the same answer bit for bit, so no better
algorithm explains the difference. This paper asks where the time goes, and answers by
changing one thing at a time, in six levels of safe, dependency-free Rust.

The obvious suspect, too few cores, is cleared early: the simplest threaded version took
{{ms threaded t=8}} on all {{env threads_native}} hardware threads, more than the
{{ms cache_friendly t=1}} that a version of the loop that merely walks memory in a better order
needs on one. On one core the textbook loop reaches {{frac naive t=1}} of the rate of an
arithmetic test loop, so it is not short of arithmetic. Most of the one-thread gain
arrived by reordering the loops and blocking them for the cache. Keeping a block of the output
in vector registers added a little more. Copying each block of the second matrix into a
contiguous buffer cut its L1 cache misses {{countratio l1d_misses simd/packed}} at the largest
size, and streaming tiles of the matrices through small buffers, a change made so that the
matrices need not fit in memory at all, gave the fastest case measured, {{speedup streaming/naive t=4}} faster
than the textbook loop on four threads. One question stays open: threads stopped helping
where the physical cores ran out, although the test loop kept gaining, and these
measurements do not say what limits them.

Compiled to WebAssembly, the same code ran in a browser at {{gflops simd lite}} on one thread,
against {{gflops simd t=1}} natively. Matrix multiplication is only the worked example; the
ideas apply wherever code moves a lot of data. Each level is presented as a method, with an
interactive diagram, driven by the real code, that shows how it divides the work.
