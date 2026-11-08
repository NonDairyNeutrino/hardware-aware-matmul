# Abstract

Dense matrix multiplication is the standard example of code whose speed depends far more on
how it is written than on what it computes. This project is not about faster algorithms:
every level performs exactly the same multiply-adds, in the same order, and returns
bit-for-bit identical results. What changes is how well the code uses the hardware. Starting
from the textbook triple loop, each level adds one idea, in safe, dependency-free Rust:
splitting the output rows across threads; reordering the loops and blocking for the cache;
keeping a block of the output in vector registers; copying each block of the second matrix
into a contiguous buffer before the vector kernel reads it; and streaming tiles of the matrices
through small buffers so that they need not fit in memory at all. On one laptop, level 3 with all its threads ran {{speedup simd/naive}} faster than the
textbook loop, and level 5 on four threads {{speedup streaming/naive t=4}}; on one thread,
most of the gain arrived with the cache blocking of level 2. Packing the second matrix
(level 4) cut its L1 cache misses {{countratio l1d_misses simd/packed n=1024}} at n = 1024 without
changing the cycles; at the largest size the same change cut the misses {{countratio l1d_misses simd/packed}},
the cycles {{countratio cycles simd/packed}} (in step with the time), and recovered most of the lead that
streaming had over level 3. Compiled to WebAssembly, the same code ran in a browser at {{gflops simd lite}} on
one thread, against {{gflops simd t=1}} natively. Matrix multiplication is only the worked
example; the ideas apply wherever code moves a lot of data. Each level is presented as a
method, with an interactive diagram, driven by the real code, that shows how it divides the
work.
