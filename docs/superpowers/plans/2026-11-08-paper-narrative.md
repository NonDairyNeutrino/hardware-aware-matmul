# Paper Narrative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the paper's prose so that every page tells one story, "the case file": a question (why does the textbook loop use so little of the core?), suspects (the six levels), evidence (Results), a verdict and one open question (Discussion, Conclusion).

**Architecture:** Prose-only change. The story is carried by the page openings and closings and by the order of the Discussion; technical content, code, figures and `results.json` do not change. Every number stays a `{{...}}` placeholder (site pages only); every comparison stated in words is covered by a test in `web/site/src/results/claims.test.mjs`.

**Tech Stack:** Markdown under `docs/`, Astro site (`web/site`, Node via Docker only), Rust doctests for the level pages.

Spec: `docs/superpowers/specs/2026-11-08-paper-narrative-design.md`.

## Global Constraints

- **Numbers only as placeholders, and only on site pages.** `docs/paper/*.md` use `{{...}}`. `docs/levels/*.md` and `docs/introduction.md` are rustdoc, so a `{{...}}` there would print literally: those pages contain **no numbers and no placeholders**. Never type a benchmark figure by hand.
- **Words that state a finding need a test.** If a sentence says "faster than", "stops", "barely", it must be covered by a test in `claims.test.mjs`. Task 1 adds the tests for the new claims; later tasks may only state claims that a test covers.
- **Honest hook.** Call the arithmetic probe "a test loop", never "the machine's limit" or "peak". Do not say what limits threads at four: the data cannot (Discussion: "What the measurements cannot say").
- **Keep the rule of the case.** Every level returns identical bits from the same multiply-adds in the same order. No sentence may suggest an algorithmic saving.
- **Level pages keep their first paragraph** (`**Level N of 5.** ...`): rustdoc uses it as the module summary. New framing goes after it, before the first `#` heading. Code blocks are doctests and are not edited.
- **Links:** `crate::<name>` only to targets listed in `web/site/site.config.mjs` `links` (existing ones: `naive`, `threaded`, `cache_friendly`, `simd`, `packed`, `streaming`, `results`, `discussion`, `conclusion`, `primer`, `introduction`, `playground`). Do not link to `tuning`, `errors`, `numerics`.
- **Commits:** the project says commit only when asked. Each task ends with a commit *step* that the executor performs only if the user has asked; messages are short one-liners, ending with the attribution line the session specifies.
- **Verification commands** (run from the repo root):
  - Node tests: `web/dev/node.sh site npm test`
  - Site build: `web/dev/node.sh site npm run build`, then `web/dev/node.sh site npm run check`
  - Doctests: `cargo test --doc`

---

### Task 0: Baseline

**Files:** none changed.

- [ ] **Step 1: Confirm everything is green before editing**

Run: `cargo test --doc 2>&1 | tail -5` and `web/dev/node.sh site npm test 2>&1 | tail -15`
Expected: doctests `test result: ok`; Node tests `fail 0`. If anything fails, stop and report: a failing baseline makes later failures unreadable.

- [ ] **Step 2: Record the section anchors that must keep working**

Run: `grep -rn "](#" docs/paper/*.md`
Expected: the list of in-page anchors (the Discussion links to `#what-the-counters-show`). Keep this list; Task 7 must keep each target heading or update the link.

---

### Task 1: Claims tests for the new story

The hook states three things in words. Add tests first so that Tasks 2 to 8 can only say what the data supports.

**Files:**
- Modify: `web/site/src/results/claims.test.mjs` (append after the test ending at the line that checks `level 3 gains much less over level 2`, or at the end of the file; position is not important)

**Interfaces:**
- Consumes (already defined in the file): `native(level, n, threads)`, `gflops(level, n, threads)`, `largest`, `mostNative`, `physicalCores`, `hardware`.
- Produces: tests named with the pages that depend on them (`Abstract, Introduction`), so a failing run points at the prose to reword.

- [ ] **Step 1: Write the tests**

```js
test('the hook: the textbook loop uses a small fraction of a test loop\'s rate on one core (Abstract, Introduction)', () => {
  // "a small fraction": the story only holds while the loop is well under a tenth of the probe.
  assert.ok(gflops(0, largest, 1) / hardware.peak_gflops[1] < 0.1);
});

test('the first clue: level 2 on one thread beats level 1 on every thread, and level 1 barely gains from four to eight (Abstract, Introduction, Discussion)', () => {
  assert.ok(native(2, largest, 1) < native(1, largest, mostNative));
  // "barely": eight threads are less than a tenth faster than four.
  assert.ok(native(1, largest, mostNative) > 0.9 * native(1, largest, physicalCores));
});

test('the verdict: the fastest case at the largest size is level 5 on four threads (Abstract, Conclusion)', () => {
  const all = [];
  for (const level of [0, 1, 2, 3, 4, 5]) {
    for (const t of level === 0 ? [1] : data.parameters.threads.native) all.push([level, t, native(level, largest, t)]);
  }
  const fastest = all.reduce((a, b) => (b[2] < a[2] ? b : a));
  assert.deepEqual(fastest.slice(0, 2), [5, physicalCores]);
});
```

- [ ] **Step 2: Run them**

Run: `web/dev/node.sh site npm test 2>&1 | grep -E "hook|first clue|verdict|^# (pass|fail)"`
Expected: all three pass on the committed data (the numbers: 0.29 against 13.5 GFLOP/s; 3646 ms on one thread against 21795 ms; level 5 on four threads, 954 ms, is the fastest). If one fails, the story in that beat is wrong for this data: stop and report, do not loosen the threshold.

- [ ] **Step 3: Commit (only if asked)**

Re-run `web/dev/node.sh site npm test 2>&1 | tail -8` (expect `fail 0`).
Commit: `git add web/site/src/results/claims.test.mjs && git commit -m "test the claims the story's hook makes"`

---

### Task 2: Abstract and Introduction

**Files:**
- Modify (full rewrite): `docs/paper/abstract.md`
- Modify (full rewrite): `docs/paper/introduction.md`

**Interfaces:**
- Consumes placeholders (all already resolve): `{{env largest}}`, `{{env madds}}`, `{{env threads_native}}`, `{{env physical_cores}}`, `{{ms naive}}`, `{{ms threaded t=8}}`, `{{ms threaded t=4}}`, `{{ms cache_friendly t=1}}`, `{{ms streaming t=4}}`, `{{gflops naive}}`, `{{peak t=1}}`, `{{frac naive t=1}}`, `{{speedup streaming/naive t=4}}`, `{{countratio l1d_misses simd/packed}}`, `{{gflops simd lite}}`, `{{gflops simd t=1}}`, and the table's `{{ms <level> [t=1]}}`.
- Produces: the question ("where did the time go?") and the term "the case" that later pages echo.

- [ ] **Step 1: Check that `{{frac naive t=1}}` resolves**

`frac` is documented as taking "a level and the usual selectors", and level 0 ignores `t=`. Verify before writing prose around it:

There is no separate command: write the placeholder in Steps 2 and 3 and let the build in Step 4 decide. If the build reports `frac`/`naive` unresolved, replace it with `{{gflops naive}}` against `{{peak t=1}}` and drop the percentage wording.

- [ ] **Step 2: Replace `docs/paper/abstract.md` with**

```markdown
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
```

- [ ] **Step 3: Replace `docs/paper/introduction.md` with**

```markdown
# A minute or a second

Multiplying two {{env largest}} × {{env largest}} matrices takes {{env madds}} multiply-adds. On
the laptop used for this paper, the textbook way to do it, three nested loops, takes
{{ms naive}}. A version that performs exactly the same multiply-adds takes {{ms streaming t=4}}.

Nothing clever happened to the arithmetic. No multiplication was skipped, no sum was reordered,
and nobody found a better algorithm: every version here returns the same answer, bit for bit.
That is the rule that makes the puzzle fair. If the arithmetic is the same, the difference must
lie in *how the work was laid out over the hardware*: which core does which part, in what order
the memory is touched, what is kept close to the arithmetic units and, for matrices too big for
memory, what is never held all at once. This paper goes looking for it, and matrix
multiplication is only the worked example.

# How much of the core was the loop using?

Start with what the machine can do. A short test loop that does nothing but multiplications
and additions, and hardly touches memory, reaches {{peak t=1}} on one core of this laptop. (It
is not the most the core could do: it uses no fused multiply-add and 128-bit vectors only.
It is a yardstick, not a limit.) The textbook loop reaches {{gflops naive}}, which is {{frac naive t=1}}
of that. The core can multiply and add far faster than the textbook loop lets it, so the
loop is not short of arithmetic. It is short of something else.

# The obvious suspect

The textbook loop runs on one core, and this laptop has {{env physical_cores}} physical cores that
offer {{env threads_native}} hardware threads (the [primer](crate::primer) explains the
difference). So the first thing to try is the obvious one: split the work across threads.
[Level 1](crate::threaded) does that, and with all {{env threads_native}} threads it takes
{{ms threaded t=8}}. Four threads took {{ms threaded t=4}}, so the second four bought almost nothing.

Then comes the clue that gives the paper its shape. A version of the loop that changes only
the order in which one thread walks through memory, [level 2](crate::cache_friendly), needs
{{ms cache_friendly t=1}} on a *single* thread. That is faster than the threaded version on every thread the
machine has. The cores were not what the loop was missing. Whatever it was missing, a
single thread could be given.

# Mechanical sympathy

The phrase comes from motor racing, where it is credited to the driver Jackie Stewart and
means driving with an understanding of how the machine works. The engineer Martin Thompson
popularised it in software. A processor is not an abstract machine that executes your loops one
step at a time. It has several cores, a hierarchy of memories that differ enormously in speed
(small, fast caches between the cores and the main memory), and vector units that do several
operations at once. The rest of the paper is a search for which of those the textbook loop was
ignoring, and what it costs to stop ignoring each one. The matrix product is a good place to
search because the algorithm fits in four lines, so nothing distracts from the hardware.

# The suspects

Each level changes how the hardware is used in one main way, and targets the bottleneck the
previous level ran into. Every level returns exactly the same bits as the one before. The times are for
{{env largest}} × {{env largest}} matrices.

[the six-level table, unchanged from the current page]

Level 5 is a different kind of step. It was built so that matrices too large for memory can be
multiplied at all, not to be faster on matrices that fit. The [Discussion](crate::discussion)
returns to what happened when it was timed anyway.

# How to read this

Read the levels in order: each [Methods](crate::naive) chapter opens with the clue the
previous level left behind and closes with what its own fix did not cure. A short
[primer](crate::primer) comes first and introduces the few hardware ideas the chapters use.
Levels 1, 2, 3 and 5 have a diagram you can step through, and levels 2, 3 and 4 have a figure
that counts what the change saves. The [Results](crate::results) are measurements of the six
levels, natively and in a web browser, on one machine; the [Discussion](crate::discussion) weighs
them and says what they do and do not show; the [Conclusion](crate::conclusion) gives the verdict
and the part that stays open. The [playground](crate::playground) runs the same benchmark on your own machine.

You can also jump straight to a chapter. Each opens by saying what it changes, and closes with
what it costs and where to go next. The code is real Rust: the diagrams are driven by it and so
are the measurements. It is written in plain loops so that each level reads like the loop nest it is.

# What this is not

[unchanged from the current page]
```

When writing the file, paste the table and the "What this is not" section verbatim from the current `docs/paper/introduction.md` where the brackets are. The brackets must not remain in the file.

- [ ] **Step 4: Build and test**

Run: `web/dev/node.sh site npm test 2>&1 | tail -8` then `web/dev/node.sh site npm run build 2>&1 | tail -15`
Expected: tests `fail 0`; build succeeds. A failure naming a placeholder (`frac`, `peak`, ...) means that placeholder does not resolve as written: fix the placeholder, never the data.

- [ ] **Step 5: Check the text for stray brackets and typed numbers**

Run: `grep -nE "\[the six|\[unchanged|[0-9]+(\.[0-9]+)? ?(ms|s|GFLOP|%)" docs/paper/abstract.md docs/paper/introduction.md`
Expected: no output.

- [ ] **Step 6: Commit (only if asked)**

`git add docs/paper/abstract.md docs/paper/introduction.md && git commit -m "open the paper with the question"`

---

### Task 3: Primer as the investigator's toolkit

**Files:**
- Modify: `docs/paper/primer.md` (the opening paragraph, the opening of "Four questions", and the closing line; no other section)

- [ ] **Step 1: Replace the opening paragraph (lines 1 to 3) with**

```markdown
The [Introduction](crate::introduction) left a question open: why does a loop that performs the
same multiply-adds as its fastest relative use so little of what the core can do? Answering it
takes a few ideas about how a processor works. This page introduces them once, with small
examples you can check by hand, so that the chapters can use them as instruments without
stopping. If you already know what a cache line, a stride, a hardware thread and a vector lane
are, skip to [level 0](crate::naive).
```

- [ ] **Step 2: Replace "# Four questions" and its first sentence with**

```markdown
# Four questions

Every suspect in the case comes down to one of four questions, and the Methods return to them
again and again. They are the checklist to carry through each chapter:
```

Leave the four numbered questions as they are.

- [ ] **Step 3: Add a closing line after the glossary table**

```markdown
That is the whole toolkit. [Level 0](crate::naive) is where the case starts.
```

- [ ] **Step 4: Build, check and commit (only if asked)**

Run: `web/dev/node.sh site npm run build 2>&1 | tail -8`. Expected: success.
Commit: `git add docs/paper/primer.md && git commit -m "frame the primer as the toolkit"`

---

### Task 4: Levels 0 to 2

**Files:**
- Modify: `docs/levels/naive.md`, `docs/levels/threaded.md`, `docs/levels/cache_friendly.md`

Each edit adds one paragraph after the first paragraph (the `**Level N of 5.**` summary and, in `naive.md`, its "New to caches..." line) and rewrites the "Where to go next" section. No numbers, no placeholders (rustdoc).

- [ ] **Step 1: `naive.md`: insert after the "New to caches, cache lines or SIMD?" line**

```markdown
This is where the case starts. It is the baseline that every other level is measured against,
and it is correct and easy to read. It is also far from what the processor can do, and nothing
in the code says why. The chapters that follow look for the reason one suspect at a time.
```

Replace the body of "# Where to go next" (the sentence before the `[`matmul`]:` link line) with:

```markdown
The first suspect is the obvious one: this loop uses one core. [`threaded`](crate::threaded) is
the smallest possible change that uses more.
```

- [ ] **Step 2: `threaded.md`: insert after the two-line summary**

```markdown
The obvious suspect is that the loop leaves most of the machine's cores idle. This level tests
that by giving every core a share of the same loop. The chapter shows how, and the measurements
show how far it gets.
```

Replace the body of "# Where to go next" with:

```markdown
More cores helped, but less than the number of cores suggests, and the arithmetic each thread
does is still the slow part. Whatever holds each thread back, more threads do not fix it.
[`cache_friendly`](crate::cache_friendly) looks at the best remaining suspect: the order in
which the loop walks memory.
```

- [ ] **Step 3: `cache_friendly.md`: insert after the summary paragraph**

```markdown
Level 1 left a clue: adding threads did not fix the loop, so how many cores did the arithmetic
was not what held it back. This level goes after the best remaining suspect, the way the
loop walks memory, and the measurements show that this one change does more on a single thread
than all the cores did at level 1.
```

Replace the body of "# Where to go next" with:

```markdown
Most of the gain is in, but the inner loop still moves `C` through memory on every step: the
data is now close to the core, and it still travels. [`simd`](crate::simd) keeps a block of `C`
in vector registers instead.

After that, one assumption remains: every level so far needs `A`, `B`, and `C` to fit in memory.
For a `100 000 × 100 000` product that is 240 GB. [`streaming`](crate::streaming) removes it.
```

- [ ] **Step 4: Check each claim in these paragraphs against the tests**

The `cache_friendly.md` claim ("more on a single thread than all the cores did at level 1") is covered by the test added in Task 1 (`the first clue`). The `threaded.md` claim ("less than the number of cores suggests") is covered by the existing test `level 1 thread scaling`. If either test has been removed or renamed, stop and report.

- [ ] **Step 5: Run the doctests and the build, then commit (only if asked)**

Run: `cargo test --doc 2>&1 | tail -4` and `web/dev/node.sh site npm run build 2>&1 | tail -6`
Expected: doctests `ok`, build success.
Commit: `git add docs/levels/naive.md docs/levels/threaded.md docs/levels/cache_friendly.md && git commit -m "link levels 0 to 2 as clues"`

---

### Task 5: Levels 3 to 5

**Files:**
- Modify: `docs/levels/simd.md`, `docs/levels/packed.md`, `docs/levels/streaming.md`

- [ ] **Step 1: `simd.md`: insert after the summary paragraph**

```markdown
Level 2 put the data close to the core, and the loop still carries the output block through
memory on every step. This level removes that last trip: it keeps a small block of the output
in the processor's vector registers for the whole inner loop. The gain is smaller than level
2's, which is itself part of the answer: most of what the loop was missing was already supplied.
```

Replace the body of "# Where to go next" (before the link-definition lines) with:

```markdown
One cost is still hidden. The kernel reads `B` where it lies in memory, a whole row apart at
every step, and that spreads each small block over many cache lines. [`packed`](crate::packed)
keeps this micro-kernel and changes where it reads `B` from: a contiguous copy of each cache
block instead of the matrix itself.
```

- [ ] **Step 2: `packed.md`: insert after the summary paragraph**

```markdown
Level 3 left a cost that only shows up in the hardware's own event counts: its kernel reads `B`
a row apart at every step. This level pays to copy each block once, which looks like a pure
loss, and the measurements ask whether the copy earns its cost back.
```

Replace the body of "# Where to go next" with:

```markdown
The copy did earn its cost back at the largest sizes, and the remaining difficulty is not speed
at all: every level so far assumes `A`, `B`, and `C` all fit in memory.
[`streaming`](crate::streaming) removes that assumption. It computes its tiles with level 2's
`axpy` kernel, not with this level's packed micro-kernel.
```

- [ ] **Step 3: `streaming.md`: insert after the summary paragraph**

```markdown
The earlier levels asked how to make the product faster. This one asks a different question:
what if the matrices do not fit in memory at all? It was built to make that possible, not to
win a race, and what happened when it was timed against the others is the twist in the story,
told in the Discussion.
```

`streaming.md` has no "Where to go next". Append at the end of its last section ("What it costs"):

```markdown
That is the last level. What the six together do and do not explain is in the Discussion, and
one question, what stops the threads, is still open there.
```

- [ ] **Step 4: Check the claims**

The `packed.md` closing ("earned its cost back at the largest sizes") is covered by `level 4 (packing) against level 3: a lead only at the two largest sizes`. The `streaming.md` twist is stated only as "what happened ... is the twist", with no comparison in words. If the `simd.md` sentence "the gain is smaller than level 2's" is kept, it is covered by `level 3 gains much less over level 2`.

- [ ] **Step 5: Run the doctests and build; commit (only if asked)**

Run: `cargo test --doc 2>&1 | tail -4` and `web/dev/node.sh site npm run build 2>&1 | tail -6`
Commit: `git add docs/levels/simd.md docs/levels/packed.md docs/levels/streaming.md && git commit -m "link levels 3 to 5 as clues"`

---

### Task 6: Results framing

**Files:**
- Modify: `docs/paper/results.md` (the opening paragraph before "# What was measured", and the lead sentence of "# Native", "# Hardware event counts", "# Noise and limits")

- [ ] **Step 1: Read the current first paragraph and each named section's first sentence**

Run: `sed -n 1,10p docs/paper/results.md; sed -n 29,36p docs/paper/results.md; sed -n 73,87p docs/paper/results.md`
Expected: the text to be edited. Do not change any table, chart or placeholder.

- [ ] **Step 2: Insert before the first paragraph**

```markdown
These are the measurements the case rests on: every level, timed natively and in a browser, with
hardware event counts for the cache-related suspects. They report what happened; the
[Discussion](crate::discussion) says what it means.
```

- [ ] **Step 3: Add one lead sentence to three sections**

- "# Native": `This section answers the first question: how much faster is each suspect than the textbook loop?`
- "# Hardware event counts": `The timings say which levels are faster; these counts say what the hardware was doing differently, and are the nearest thing to direct evidence for the memory-system suspects.`
- "# Noise and limits": `Before the Discussion weighs this evidence, here is how much to trust it.`

- [ ] **Step 4: Build; commit (only if asked)**

Run: `web/dev/node.sh site npm test 2>&1 | tail -5` and `web/dev/node.sh site npm run build 2>&1 | tail -6`
Commit: `git add docs/paper/results.md && git commit -m "frame the results as evidence"`

---

### Task 7: Discussion in the order of the case

The largest task. Move existing text; write only the lead sentences listed. Keep every placeholder and every sentence of the moved text, except where a step says otherwise.

**Files:**
- Modify: `docs/paper/discussion.md`

**Target order and headings** (existing heading in brackets):

| # | New heading | Source |
|---|-------------|--------|
| 0 | (opening paragraph) | rewrite, Step 1 |
| 1 | `# The answer does not change` | unchanged |
| 2 | `# The first suspect: the cores` | first two paragraphs of `# What threads add` and the sentence about level 1 on one thread from `# Where the single-thread gain comes from` |
| 3 | `# The culprit: memory` | all of `# Where the single-thread gain comes from` except the level 1 sentence; the naive-against-level-2 counts text stays here |
| 4 | `# Cleaning up: registers and packing` | the level 3 paragraph from the culprit section, plus all of `# What packing and streaming cost, and what they did not` up to (not including) the streaming discussion |
| 5 | `# What the counters show` | unchanged, so the in-page link `#what-the-counters-show` keeps working |
| 6 | `# The twist: streaming` | the level 5 parts of `# What packing and streaming cost, and what they did not` |
| 7 | `# The part left open: what stops the threads` | the rest of `# What threads add` (levels 2 to 5 scaling, triad and peak probe, throughput against size) |
| 8 | `# Browser against native` | unchanged |
| 9 | `# What the measurements cannot say` | unchanged |

- [ ] **Step 1: Replace the opening paragraph with**

```markdown
The [Results](crate::results) report what was measured; this page weighs it. The question from
the [Introduction](crate::introduction) was where the time of the textbook loop goes, and the
sections below take the suspects in the order the evidence clears or convicts them: the cores,
the memory system, the registers and the copy, the twist at level 5, and the one question that
stays open. Everything below refers to the reference run: one laptop, one day, one browser.
Every figure is filled in from that run's committed data. Where a sentence explains a
difference rather than reports it, the sentence says so, and where the data cannot tell two
explanations apart, the page says that too.
```

- [ ] **Step 2: Add one lead sentence under each new heading (verbatim)**

- `# The first suspect: the cores`: `The obvious explanation is that the textbook loop leaves most of the cores idle. The measurements clear it, or at least show it is not the main cause.`
- `# The culprit: memory`: `The best explanation of the rest is the memory system, with the caveat that the run measured it directly only at two sizes.`
- `# Cleaning up: registers and packing`: `Two smaller changes follow, each removing a cost the previous level still paid.`
- `# The twist: streaming`: `Level 5 was built for matrices that do not fit in memory, not for speed, and it is nonetheless the fastest case measured.`
- `# The part left open: what stops the threads`: `One question is not settled by these measurements, and it is the most interesting one: threads stopped helping where the physical cores ran out, although a test of arithmetic alone kept gaining.`

- [ ] **Step 3: Move the text as the table says**

Do it with Edit, section by section; do not retype the prose. After each move, run `grep -c "{{" docs/paper/discussion.md` and confirm the count is the same as before the task (no placeholder lost). Two sentences need a connective fix after the move: any "below" or "above" that now points the other way (search with `grep -n "below\|above" docs/paper/discussion.md`) and the reference "see What the counters show below", which still resolves because the counters section stays.

- [ ] **Step 4: Check the claims in the new lead sentences**

`The measurements clear it, or at least show it is not the main cause` is covered by Task 1's `the first clue`; `nonetheless the fastest case measured` by `level 5 on four threads, natively, is the fastest case measured at the largest size`; `kept gaining` by the existing `hardware probe` test. If a lead sentence goes beyond its test, soften the sentence.

- [ ] **Step 5: Verify**

Run: `grep -c "{{" docs/paper/discussion.md` (same count as in Step 3), `web/dev/node.sh site npm test 2>&1 | tail -5`, `web/dev/node.sh site npm run build 2>&1 | tail -8`, `web/dev/node.sh site npm run check 2>&1 | tail -8`
Expected: tests `fail 0`; build and check succeed, which also verifies the in-page anchors.

- [ ] **Step 6: Commit (only if asked)**

`git add docs/paper/discussion.md && git commit -m "order the discussion as the case"`

---

### Task 8: Conclusion as the verdict

**Files:**
- Modify: `docs/paper/conclusion.md` (the opening paragraph; the order and lead sentences of its first three sections; the closing of "What it means")

- [ ] **Step 1: Replace the opening paragraph (the one beginning "This project asked how much of a program's speed") with**

```markdown
The case began with one question: why does the textbook matrix product use so little of what
the core can do, when a version with the same arithmetic is so much faster? The answer is
mostly in how the work meets memory, and partly still open.
```

- [ ] **Step 2: Rename and re-lead the three sections**

- `# What was done` → `# The suspects`. Keep its list of levels; change its first sentence to `The [Introduction](crate::introduction) set the rule of the case: six implementations of the same product, each computing the same result bit for bit, so that nothing but the use of the hardware can explain a difference. The Methods then tried one suspect at a time:`
- `# What was found` → `# The verdict`. Keep its content and placeholders; begin it with: `The cores were not the main cause: the cache-friendly level on one thread beat the simplest threaded level on all of them. Most of the one-thread gain came from reordering the loops and blocking for the cache, the vector kernel and the packed copy then each took a smaller step, and streaming, built for a different reason, was the fastest case measured.` Follow with the existing paragraph, minus its first sentence (which repeats this).
- `# What it means, and what it does not` → keep the title; append one paragraph:

```markdown
One question is left open, and it is the one to take away from the case. Threads stopped
helping where the physical cores ran out, while a test of arithmetic alone kept gaining, and
the run measured main-memory bandwidth and found it an unlikely limit, at least for level 5.
What the cores share besides the arithmetic (their caches, the machinery that feeds the
execution units) was not measured. The [playground](crate::playground) lets a reader see whether
the same shape appears on their own machine.
```

- [ ] **Step 3: Check the claims**

Every sentence in Step 2 is covered: `cores were not the main cause` (Task 1 `first clue`), `most of the one-thread gain` (existing), `fastest case measured` (Task 1 `verdict`), the open question (existing `hardware probe`). Confirm by running the Node tests.

- [ ] **Step 4: Build and commit (only if asked)**

Run: `web/dev/node.sh site npm test 2>&1 | tail -5` and `web/dev/node.sh site npm run build 2>&1 | tail -6`
Commit: `git add docs/paper/conclusion.md && git commit -m "write the conclusion as the verdict"`

---

### Task 9: Read through in order and verify everything

**Files:** none unless the read-through finds a problem.

- [ ] **Step 1: Full verification**

Run, in order: `cargo test 2>&1 | tail -6`, `web/dev/node.sh site npm test 2>&1 | tail -8`, `web/dev/node.sh site npm run build 2>&1 | tail -8`, `web/dev/node.sh site npm run check 2>&1 | tail -8`
Expected: everything passes; `check` also confirms no gate pages leak into production.

- [ ] **Step 2: Scan for typed numbers and leftovers**

Run: `grep -nE "TODO|TBD|\[unchanged|\[the six" docs/paper/*.md docs/levels/*.md` and `grep -nE "\b[0-9]+(\.[0-9]+)? ?(ms|GFLOP/s|GB/s|%|×)" docs/paper/*.md docs/levels/*.md | grep -v "{{"`
Expected: no output from the first. The second may show sizes like `100 000 × 100 000` (an example, not a measurement) and the matrix dimensions in the table; anything that is a measured figure must become a placeholder or go.

- [ ] **Step 3: Read the pages in reading order and answer one question per page**

Read: abstract, introduction, primer, levels 0 to 5, results, discussion, conclusion. For each, check: *what question does this page open with, and does a later page answer it or say it stays open?* The chain to confirm:

1. Intro asks where the time goes → Levels 1 and 2 clear the cores and name memory → Discussion convicts memory (with its caveat) → Conclusion repeats the verdict.
2. Intro says level 5 is a different kind of step → Level 5 chapter tells why → Discussion has "The twist" → Conclusion says it was fastest.
3. Discussion's "The part left open" → Conclusion's open question → the playground.

Fix any break with a one-sentence edit and re-run Step 1.

- [ ] **Step 4: Update the paper-structure notes**

`CLAUDE.md` says the paper is "six levels" and describes `docs/paper/`; nothing in it needs to change. If the read-through changed any section title that other pages or `site.config.mjs` `sectionTitles` refer to, run `web/dev/node.sh site npm run check` again.

- [ ] **Step 5: Report**

Tell the user which pages changed, the test and build results (with the actual output, including any failure), and which sentences were softened because a claims test did not cover them.
