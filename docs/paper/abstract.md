# Abstract

At n = {{env largest}}, the textbook three loops multiply two matrices in {{ms naive}}. Another version takes {{ms streaming t=4}}. Both do the same multiply-adds in the same order and return the same bits, so a better algorithm is not the reason. Where does the time go?

More cores were not the answer. The simplest threaded version took {{ms threaded t=8}} on all {{env threads_native}} threads. A version that only reorders the loops took {{ms cache_friendly t=1}} on one. On one core, the textbook loop reaches just {{frac naive t=1}} of a test loop's rate.

Memory is the likely culprit. Reordering the loops and blocking them for the cache gave most of the one-thread gain. Copying blocks of the second matrix into a contiguous buffer cut L1 cache misses {{countratio l1d_misses simd/packed}}. Streaming tiles through small buffers was fastest: {{speedup streaming/naive t=4}} faster than the textbook loop, on four threads.

One question stays open. The three fastest levels stopped gaining where the physical cores ran out, though the test loop kept gaining. The data cannot say why.

In a browser, the same code ran at {{gflops simd lite}} on one thread, against {{gflops simd t=1}} natively.
