# Abstract

Dense matrix multiplication is the standard example of code whose speed depends far
more on how it is written than on what it computes. This project is not about faster
algorithms: every level performs exactly the same multiply-adds, in the same order, and
returns bit-for-bit identical results. What changes is how well the code uses the
hardware. Starting from the textbook triple loop, each level adds one idea, in safe,
dependency-free Rust: splitting the output rows across threads; reordering the loops and
blocking for the cache; keeping a block of the output in vector registers; and streaming
tiles of the matrices through small buffers so that they need not fit in memory at all.
Matrix multiplication is only the worked example; the ideas apply wherever code moves a
lot of data. Each level is presented as a method, with an interactive diagram, driven by
the real code compiled to WebAssembly, that shows how the level divides the work.
