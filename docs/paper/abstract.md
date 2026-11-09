# Abstract

At n = {{env largest}}, the textbook three loops multiply two matrices in {{ms naive}}. Another version takes {{ms streaming t=4}}. Both do the same multiply-adds in the same order and return the same bits, so a better algorithm is not the reason. Where does the time go?

We built six levels of Rust and changed one thing at a time: threads, cache blocking, register blocking, a packed copy of the second matrix, and streaming tiles through small buffers. Every level returns the same bits, so any speedup comes from how the work meets the hardware. We timed each level natively and in a browser, and counted cache events.

The time most likely went to waiting for memory, not to too few cores: one thread with the loops reordered beat the simple threaded version on every thread count. Cache blocking gave most of the one-thread gain, and packing cut L1 cache misses {{countratio l1d_misses simd/packed}}. Streaming, built so the matrices need not fit in memory, was fastest, {{speedup streaming/naive t=4}} faster than the textbook loop on four threads.
