# The Paper as a Case File: a Narrative Through-line

Status: design approved in conversation, 2026-11-08. Builds on the paper structure
(`2026-11-06-paper-structure-design.md`) and the results design
(`2026-11-06-results-design.md`). Prose only: no code, data or site-machinery changes.

## Problem

The paper has the shape of a scientific paper (abstract, introduction, methods, results,
discussion, conclusion) but reads as a collection of facts. The Introduction states the
headline speedup and the level table before the first Methods chapter, so nothing is left to
find out. There is no question the reader wants answered and no mystery that develops.

## Goal

One story, told across every page: a situation with a problem, and methods that solve it
better and better. The reader should keep reading to find out why.

Scope is every paper page: abstract, introduction, primer, the six level chapters, results,
discussion and conclusion. Technical content, code blocks and generated figures stay as they
are; what changes is framing, order and the joints between pages.

## The story: one case file

**The question.** Why does a core that can sustain a stream of multiply-adds spend most of
its time, on the textbook matrix product, doing something else? At n = 2048 the textbook loop
reaches 0.29 GFLOP/s on one thread, while an arithmetic test loop on the same core reaches
13.5 (about 2%). The same arithmetic takes about a minute in one version and about a second
in another.

**The rule that makes it fair.** Every level returns bit-identical results from the same
multiply-adds in the same order. The answer can never be a better algorithm; it must lie in
how the work meets the hardware. This moves from a disclaimer to the premise of the puzzle.

**The beats.**

1. The gap: the loop gets a small fraction of what a test loop gets on the same core.
2. The obvious suspect fails: threads (level 1). Eight threads barely beat four, and level 2
   on one thread beats level 1 on all eight. The cores were not the problem.
3. The real culprit: the loop waits on memory (level 2; the primer's cache and access-order
   ideas).
4. Cleaning up what remains: results kept in registers (level 3); then packing removes a cost
   the vector kernel was still paying (level 4).
5. The twist: level 5 was built to make an impossible problem possible (matrices that do not
   fit in memory), yet at the largest sizes it is also the fastest.
6. The part left open: threads stop helping at four although the arithmetic test keeps
   gaining. The case does not fully close, and the Conclusion says so.

**Honesty constraint.** The hook must call the arithmetic probe "a test loop", never "the
machine's limit" (it is SSE2, no fused multiply-add). Suspense comes only from findings the
data supports; open questions stay open. No invented drama.

## Per-page plan

### Front of the paper

- **Abstract.** Shrinks to the question, the rule (same bits, same arithmetic) and the
  finding in two or three sentences. The inventory of counter ratios moves out; Results and
  Discussion already hold it.
- **Introduction.** Rebuilt around the gap: the arithmetic probe beside the naive loop's rate,
  then the one-thread-beats-eight clue, then the rules of the case. The six-level table stays,
  reframed as the suspects, with its bottleneck column. The headline speedup and the "where the
  speedup comes from" section are withheld here and revealed in the chapters. "How to read
  this" and "What this is not" stay, shortened.
- **Primer.** The same content (cache lines, access order, reuse, cores and lanes), introduced
  as the instruments needed to read the clues. The four questions stay as the method.

### Methods (levels 0 to 5)

Technical content and code are unchanged. Each chapter gets:

- an opening that states the clue it inherited ("level 1 left us here");
- a closing that names what its fix did not cure and hands off to the next chapter ("Where to
  go next" becomes the cliffhanger).

Level 0 is posed as the scene of the crime. Level 5 carries the twist framing.

### Back of the paper

- **Results.** Light touch: a short framing paragraph ("the evidence") and clearer section
  leads. Tables, charts and numbers untouched.
- **Discussion.** Reordered to follow the case: the cleared suspect (threads), the culprit
  (memory), the cleanups (registers, packing), the twist (streaming), then the open question
  (what limits threads), then limits of the measurements. Each findings section gains a lead
  sentence naming the question it settles.
- **Conclusion.** The verdict: what was established, what was only suggested, what stays
  unsolved, and the four questions as what to take away.

## Constraints

- **Numbers.** Only as `{{...}}` placeholders; nothing typed by hand. Any figure worth citing
  that has no placeholder gets one (in `web/site/src/results/lookup.mjs`, with a test) or is
  left out. The figures in this document are for design discussion only and must not be copied
  into prose.
- **Claims.** Any sentence that states a finding in words is checked against
  `web/site/src/results/claims.test.mjs`. If a run would flip it, the prose is reworded; the
  data is never touched.
- **Doctests.** Level pages are rustdoc: code blocks stay as they are, and
  `cargo test --doc` must pass.
- **Links.** Only to pages that exist and are listed in `site.config.mjs`.
- **Unchanged pieces.** The core invariant, all code, `results.json`, figures and demos.

## Order of work and verification

Dependency order, one small commit per group of pages (only when asked):

1. Introduction and abstract (they set the question the rest answers).
2. Primer.
3. Level chapters 0 to 5 (openings and closings).
4. Results framing.
5. Discussion.
6. Conclusion.

After each group: the site build and tests (`web/dev/node.sh`, Node runs only in Docker) and
`cargo test --doc`. A final read-through in reading order checks that each page's question is
answered, or deliberately left open, by a later one.

## Out of scope

New experiments, new levels, changes to the data or the benchmark script, changes to the site
machinery, and the animations (they already describe the six levels).
