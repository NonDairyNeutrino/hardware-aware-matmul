The [Introduction](crate::introduction) left a question open: why does a loop that performs the
same multiply-adds as its fastest relative use so little of what the core can do? Answering it
takes a few ideas about how a processor works. This page introduces them once, with small
examples you can check by hand, so that the chapters can use them as instruments without
stopping. If you already know what a cache line, a stride, a hardware thread and a vector lane
are, skip to [level 0](crate::naive).

# Arithmetic is cheap, moving data is not

A processor core can do arithmetic much faster than the main memory can hand it numbers. The
gap is large enough that many programs spend much of their time waiting for data, not computing. Hardware designers soften this with a **memory hierarchy**: a few small, fast
memories close to the core, backed by larger, slower ones.

```text
  registers   a few dozen values, inside the core        fastest, smallest
  L1 cache    tens of KiB, per core
  L2 cache    hundreds of KiB, per core
  L3 cache    several to tens of MiB, shared by all cores
  main memory (RAM)    GiB, shared                       slowest, largest
```

The sizes differ between processors; what matters is the shape. Every step down is
bigger and slower, and the processor looks for a value in the smallest memory first. A
**cache** keeps copies of recently used data so that using it again is fast. When the
cache is full, something has to go: the processor **evicts** a copy to make room.

The unit of transfer between memory and cache is not a single number but a **cache line**:
a block of neighbouring bytes, typically 64, which is eight `f64` values. Asking for one number brings in the rest of its line, seven more values. That is free if you use them, and wasted if
you do not.

# Walking along a row, walking down a column

A matrix is stored **row by row**: the elements of the first row, then the second row, and
so on. Take an 8 × 8 matrix, and, to keep the picture small, a cache line of four values
instead of eight. Each row is two cache lines.

Walking along a row touches eight values and brings in two cache lines: every value
that arrives is used. Walking **down a column**, a **strided** walk in which each step jumps over a whole row, touches eight values and brings in eight
cache lines, one per row, and uses one value in each: a quarter of what was fetched. With
real 64-byte lines it is one value in eight.

The waste is avoidable if the lines survive in the cache until the next column asks for their
neighbours. For a matrix with n rows, a column walk touches n lines, so keeping them needs
n lines of 64 bytes: 64 KiB for n = 1024, which is more than the {{env l1d}} L1 data cache of the laptop used in this paper holds. If the lines do not all stay in the cache, then by the time the loop moves to the next column they have been evicted and must be fetched again. That is the likely reason the textbook loop of level 0 slows down as matrices grow, and it is why level 2 rearranges its loops. The [Discussion](crate::discussion) says how far the measurements support this.

# There is a lot of reuse to be had

Multiplying two n × n matrices does 2n³ floating-point operations on 3n² numbers.
That is 2n/3 operations for every number in the problem: about 680 at n = 1024. Each
element of `A` and `B` is used n times. Moving a number from memory costs far more than doing
arithmetic with it, so a good implementation ideally loads each number once, or as few times as possible, and uses it many times before it leaves the fast memory.

The levels differ in how much of that **reuse** they capture. The measure to keep in mind is
**bytes moved per operation**: the fewer bytes the program drags through the slow memories
for each multiply-add, the less time it waits. Every level of the Methods is an answer to
the question "how can the same arithmetic move fewer bytes, or move them in a way the
hardware likes?"

A program is **memory-bound** when waiting for data sets its speed, and **compute-bound**
when the arithmetic does. **Bandwidth** is the number of bytes per second a memory can
deliver, and the cores of a processor share it.

# Cores, hardware threads and vector lanes

A processor has several **cores**, and each can run its own thread of the program. The
reference machine of the Results, {{env cpu}}, has {{env physical_cores}} physical cores. It
also presents {{env cores}} **hardware threads**: each core can keep two threads in flight, and while one waits for memory the other can use the core's idle arithmetic units; the two share those units.
A second thread on a core therefore helps a program that waits a lot, and helps a program that
rarely waits only a little.

Inside a core, the arithmetic units work on **registers**, the processor's own working
storage. A **vector register** holds several values at once, and one **SIMD** instruction
("single instruction, multiple data") operates on all of them. Each value's slot is a
**lane**. A 128-bit register holds two `f64` values, so one instruction does two
multiplications. The Results use 128-bit vectors in both environments:
{{env native_isa}} natively and {{env browser_isa}} in the browser. (The machine could do wider vectors; a default build does not ask for them, which also keeps the native and browser results comparable.)

# Four questions

Each suspect in the case comes down to one of four questions, and the Methods return to them
again and again. They are the checklist to carry through each chapter:

1. **Is the access contiguous?** Does the code use every byte of the cache lines it fetches?
2. **What is reused, and how far apart are the uses?** Does a value stay in a fast memory
   until it is used again?
3. **How many bytes move per operation?** Is that more than the memory bandwidth of the machine can supply?
4. **Is there independent work for every core and every lane?**

# Terms used in the chapters

| Term | Meaning |
|------|---------|
| cache | a small, fast memory holding copies of recently used data |
| cache line | the block of neighbouring bytes moved at once, typically 64 bytes |
| evict | drop a cached copy to make room |
| stride, strided | the distance in memory between consecutive accesses; a walk that jumps over data is strided |
| contiguous | neighbours in memory, accessed one after another |
| reuse | using a loaded value more than once before it leaves fast memory |
| bandwidth | bytes per second a memory can deliver |
| memory-bound, compute-bound | speed limited by data movement, or by arithmetic |
| hardware thread | one stream of instructions a core can run; a core may offer two. Also called a logical core; "hyper-thread" is the same thing when two share a core |
| register, vector register | the processor's working storage; one that holds several values |
| lane | one value's slot in a vector register |
| vectorise | the compiler turns a scalar loop into SIMD instructions |
| register blocking | keeping a small block of the output in registers while it is updated |
| block, tile | a small rectangular piece of a matrix worked on at a time; at level 2 small enough to stay in the cache |
| hit, miss | a hit finds the data in the cache; a miss must fetch it from a slower memory |
| GFLOP/s | billions of floating-point operations per second |
| axpy | `y ← y + a·x` over two slices; the inner loop of levels 2 to 5 |
| work queue | threads claim the next small piece of work when they are free, instead of getting a fixed share in advance |
| thread | an independent sequence of instructions that the program runs |
| SIMD | one instruction operating on all the lanes of a vector register |
| last-level cache (LLC) | the largest cache, usually the L3 and usually shared by the cores; a load that misses it goes to main memory |
| cycle | one tick of the processor's clock; a cycle count measures time in ticks |
| instructions per cycle (IPC) | how many instructions the core finishes per cycle; a high figure means it is rarely waiting |
| TLB | a small cache of the translations from a program's addresses to physical memory; a miss costs a lookup |
| STREAM triad | a standard test of memory bandwidth: it streams three large arrays and measures bytes per second |
| L1, L2, L3 | the levels of cache, from the smallest and fastest, private to one core, to the largest and slowest, usually shared by the cores |
| FMA (fused multiply-add) | one instruction that multiplies and adds with a single rounding, so its result can differ from a separate multiply and add |
| micro-kernel | the innermost routine that updates a small block of the output held in vector registers |
| packing | copying a block of a matrix into a contiguous buffer, laid out in the order the code reads it |
| broadcast | copying one value into every lane of a vector register |
| memory page | the unit in which the operating system maps a program's addresses to physical memory; each page in use needs a TLB entry |
| prefetch, prefetcher | fetching data into the cache before the code asks for it; a prefetcher is hardware that does this when it spots a regular pattern of accesses |
| speedup | how many times faster one case is than another: the slower time divided by the faster |

That is the whole toolkit. [Level 0](crate::naive) is where the case starts.
