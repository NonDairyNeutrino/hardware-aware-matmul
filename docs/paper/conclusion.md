With the arithmetic unchanged, layout alone moved the running time by more than an order of
magnitude.

One question is left open. Threads stopped helping levels 3 to 5 where the physical cores ran
out, although a test of arithmetic alone kept gaining. These measurements do not say what limits
them; the Discussion's section
[The part left open](../discussion/#the-part-left-open-what-stops-the-threads) sets out what
they can and cannot say. The [playground](crate::playground) can show whether threads stop
helping at the physical cores on other hardware too.

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
tells you whether you were right.

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
