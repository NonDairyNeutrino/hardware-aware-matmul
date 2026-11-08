# Discussion Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docs/paper/discussion.md` friendlier to readers who struggle with long unbroken text and number-dense sentences (an ADHD readability review found the Discussion holds 28% of the words and 70% of the numbers, with paragraphs up to 326 words and 18 numbers): replace number lists with small tables, move the browser side-trip after the open question, and gather each section's caveats into one labelled paragraph.

**Architecture:** Prose-and-structure change to one page. Every sentence that states a finding is kept (moved or kept in place, never retyped); every number stays a `{{...}}` placeholder; tables carry numbers that sentences used to list. No claim is added, so no new test is needed, and the existing `claims.test.mjs` coverage still applies to the unchanged claim sentences.

**Tech Stack:** Markdown (`docs/paper/discussion.md`), Astro site (Node via Docker only: `web/dev/node.sh`).

Spec for the motivation: the ADHD-readability review of the paper (this conversation); the story it must keep: `docs/superpowers/specs/2026-11-08-paper-narrative-design.md`.

## Global Constraints

- **Only `docs/paper/discussion.md` changes.** No other file, no data, no tests, no code.
- **Numbers only as `{{...}}` placeholders.** Never type a benchmark figure. A table cell holds a placeholder, a short label or a size such as `256`. Placeholders already render with their unit (for example a time as seconds or milliseconds, a rate with GFLOP/s), so do not add units to table headers; name the quantity.
- **Move, never retype.** Each claim sentence is kept word for word (it may move to a new place or become the lead above a table). Allowed text changes: the table-introducing lead sentences given in this plan, the bold lead of each "What this does not show" paragraph, and the shortest connective needed where a move leaves a dangling reference (list each in the report).
- **Placeholder multiset.** Before each task save `grep -o "{{[^}]*}}" docs/paper/discussion.md | sort | uniq -c`; after the task diff it. Allowed differences are listed per task (additions that a table needs, and removals only of a duplicated placeholder replaced by the table). Report the diff.
- **Sentence accounting.** Before each task copy the page; after the task run a sentence-level multiset comparison (headings and table rows stripped, line wraps ignored). Lost or changed sentences are allowed only where this plan lists them.
- **Keep the anchor.** The heading `# What the counters show` stays unchanged (`[What the counters show](#what-the-counters-show)` links to it).
- **Claims must stay within their tests.** Do not strengthen or widen any sentence (for example, keep "levels 3 to 5" where it says threads stopped helping). Do not say what limits threads at four. Call the arithmetic probe a test, never "peak" or "the machine's limit" in prose.
- **Links:** only `crate::<name>` targets listed in `web/site/site.config.mjs` `links` (existing ones in the page are fine).
- **Commits:** one commit per task, one-line message, then a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Work is on branch `discussion-readability` (the user approved branch-plus-small-commits for the previous pass; the reviewer should confirm this is acceptable if the user has not repeated it).
- **Verification commands** (repo root; Node only via Docker; the build takes minutes):
  - `web/dev/node.sh site npm test` (expect 157 pass, 0 fail)
  - `web/dev/node.sh site npm run build`, then `web/dev/node.sh site npm run check`
  - `cargo test --doc` is not needed (no rustdoc page changes).

---

### Task 1: "The culprit: memory": two tables

**Files:**
- Modify: `docs/paper/discussion.md` (section `# The culprit: memory`, the second and third paragraphs)

- [ ] **Step 1: Save the baseline.** Save the placeholder multiset and a copy of the page to the scratchpad.

- [ ] **Step 2: Replace the paragraph that begins "The size of that gain depends on the size of the problem"** (it currently lists the speedups at four sizes and the level 0 throughput at three, then goes on about the caches). Split it into three pieces, keeping every sentence of the old paragraph except the two list sentences ("On one thread level 2 was ... faster than level 0 at n = 256, ... at n = {{env largest}}." and the sentence "its throughput is ... at n = {{env largest}}") that the table replaces:

```markdown
The size of that gain depends on the size of the problem, though not smoothly. On one thread
it barely moves between the two smaller sizes and grows after them, mostly because level 0
slows down:

| n | level 2 faster than level 0, one thread | level 0 throughput |
|---|---|---|
| 256 | {{speedup cache_friendly/naive t=1 n=256}} | {{gflops naive n=256}} |
| 512 | {{speedup cache_friendly/naive t=1 n=512}} | {{gflops naive n=512}} |
| 1024 | {{speedup cache_friendly/naive t=1 n=1024}} | {{gflops naive n=1024}} |
| {{env largest}} | {{speedup cache_friendly/naive t=1}} | {{gflops naive}} |

This is what one would expect if the cause is the memory system, and two things about this
machine's caches change between n = 512 and n = 1024. <the rest of the old paragraph from
"The three matrices together take 6 MiB" through "...so they cannot say which of the two changes there matters." EXCEPT the cache-miss sentences listed in Step 3>
```

Note: the old text "The gain barely moves between the two smaller sizes and grows after them, mostly because level 0 slows down" is kept in meaning in the new lead ("it barely moves ... slows down"); the old words "The gain" become "On one thread it" because the table follows. This is the only wording change to a claim sentence in this task; the claim's scope (one thread) is unchanged.

- [ ] **Step 3: Replace the cache-miss sentences with a table.** The old text, from "Cache-miss counts bear on this, though only at two sizes: the counting run (see [What the counters show](#what-the-counters-show) below) found, at n = 1024, that the naive loop missed..." through "...the naive walk goes to main memory." (about six placeholders per sentence, in three sentences) becomes:

```markdown
Cache-miss counts bear on this, though only at two sizes (see
[What the counters show](#what-the-counters-show) below). The counting run found:

| | naive loop | level 2 |
|---|---|---|
| L1 data-cache miss rate, n = 1024 | {{count l1d_miss_rate naive n=1024}} | {{count l1d_miss_rate cache_friendly n=1024}} |
| loads sent on to the last-level cache, n = 1024 | {{count llc_loads naive n=1024}} | {{count llc_loads cache_friendly n=1024}} |
| loads that reach the last-level cache and miss it, n = {{env counters_n}} | {{count llc_misses naive}} | {{count llc_misses cache_friendly}} |

That fits the memory system as the cause: at n = {{env counters_n}} the naive walk goes to main
memory.
```

Keep, in the place the old text had them, the sentences "Either could explain the fall, and the data cannot tell them apart; nor can they rule out a third cause, such as rows whose length is a power of two competing for the same places in a cache." and "The counts were taken at two sizes, neither of them between n = 512 and n = 1024, so they cannot say which of the two changes there matters." (Task 5 moves them later.) Place them after the cache explanation and after the counts table respectively, in the old order, so the paragraph still reads: caches change, either could explain the fall, the counts, what the counts cannot say.

- [ ] **Step 4: Check the placeholder multiset.** Allowed difference: `{{gflops naive n=256}}` added once; `{{env largest}}` count changes only by the removed list sentences' repeats (report the exact diff); `{{env counters_n}}` may gain one; every `{{speedup ...}}`, `{{gflops ...}}` (other than the new one), `{{count ...}}` and `{{env ...}}` placeholder of the old paragraph is otherwise still present once.

- [ ] **Step 5: Sentence accounting and verification.** Lost sentences: only the three list sentences named above. Run `web/dev/node.sh site npm test`, then the build and the check; confirm the tables render (look in `web/site/dist/discussion/index.html` for the two `<table>` elements with no literal `{{`: `grep -c "{{" web/site/dist/discussion/index.html` must print 0).

- [ ] **Step 6: Commit.** `git add docs/paper/discussion.md && git commit -m "tabulate the culprit section's figures"` (with the attribution line).

---

### Task 2: "Cleaning up", "What the counters show" and "The twist": tables

**Files:**
- Modify: `docs/paper/discussion.md` (the three sections named)

- [ ] **Step 1: Save the baseline** (multiset and page copy).

- [ ] **Step 2: "Cleaning up": level 3 against level 4 by thread count.** In the paragraph that begins "[Level 4](crate::packed) adds a copy to level 3", replace the sentence "At n = {{env largest}}, level 4 takes {{ms packed t=1}} on one thread against level 3's ... and {{ms packed t=8}} on eight against {{ms simd t=8}}." by a lead and a table, and keep every other sentence of the paragraph (including "level 4 was faster than level 3 at every thread count" and the n = 1024 and smaller-sizes sentences):

```markdown
At n = {{env largest}}:

| threads | level 3 | level 4 |
|---|---|---|
| 1 | {{ms simd t=1}} | {{ms packed t=1}} |
| 2 | {{ms simd t=2}} | {{ms packed t=2}} |
| 4 | {{ms simd t=4}} | {{ms packed t=4}} |
| 8 | {{ms simd t=8}} | {{ms packed t=8}} |
```

(Place the table after "...level 4 was faster than level 3 at every thread count." and before "At n = 1024 the lead is much smaller ...".) Allowed multiset change: none (every placeholder moves into the table).

- [ ] **Step 3: "What the counters show": two tables.** Keep the opening paragraph (which says what was counted). Replace the n = 1024 paragraph's number-heavy sentences and the largest-size paragraph's with a lead, a table and the conclusion sentences, keeping every sentence that is not purely a list of the numbers (the interpretations, "That matches the timings at that size ...", "One reading is that ...", "This is the strongest evidence in this paper for a cause, and it still has limits ...").

For n = 1024 (keep "{{countratio l1d_misses simd/packed n=1024}} fewer" in a sentence):

```markdown
At n = 1024, level 4 had {{countratio l1d_misses simd/packed n=1024}} fewer L1 data-cache misses
than level 3, but its cycle count did not follow, at about the same instructions per cycle:

| n = 1024 | L1 data-cache misses | cycles | instructions per cycle |
|---|---|---|---|
| level 3 | {{count l1d_misses simd n=1024}} | {{count cycles simd n=1024}} | {{count ipc simd n=1024}} |
| level 4 | {{count l1d_misses packed n=1024}} | {{count cycles packed n=1024}} | {{count ipc packed n=1024}} |
```

followed by the old sentences "That matches the timings at that size, where level 4 is only slightly ahead. One reading is that the misses of level 3 were served from the L2 cache ...; the counts do not test that."

For the largest size (keep the sentence "Its cycles fell with them ... by about the fraction by which its one-thread time was shorter ({{ms packed t=1}} against {{ms simd t=1}})" with its two `{{ms ...}}` placeholders, and the instructions-per-cycle rise stated in words without the two ipc placeholders now in the table):

```markdown
At n = {{env counters_n}} the same removal pays: level 4 had {{countratio l1d_misses simd/packed}}
fewer L1 misses than level 3, and sent far fewer loads on to the last-level cache, because the
strided reads of the second matrix had stopped being caught by the L2.

| n = {{env counters_n}} | L1 data-cache misses | loads to the last-level cache | cycles | instructions per cycle | L1 loads |
|---|---|---|---|---|---|
| level 3 | {{count l1d_misses simd}} | {{count llc_loads simd}} | {{count cycles simd}} | {{count ipc simd}} | {{count l1d_loads simd}} |
| level 4 | {{count l1d_misses packed}} | {{count llc_loads packed}} | {{count cycles packed}} | {{count ipc packed}} | {{count l1d_loads packed}} |
| level 5 | {{count l1d_misses streaming}} | {{count llc_loads streaming}} | {{count cycles streaming}} | {{count ipc streaming}} | {{count l1d_loads streaming}} |
```

then the kept sentences: "Its cycles fell with them, by about the fraction by which its one-thread time was shorter ({{ms packed t=1}} against {{ms simd t=1}}), and its instructions per cycle rose. So on one thread the faster time comes with fewer cycles and fewer loads that left the L2, which is what the reading ... predicted. This is the strongest evidence in this paper for a cause, and it still has limits: ..." and the level 5 paragraph's interpretation ("Level 5 goes further at that size ... It executes more L1 loads than level 4, because its kernel is level 2's rather than the register-blocked one, so it does more work and spends less time waiting. The cycles order levels 3, 4 and 5 as the times do (level 5's times follow in the twist below). The step from level 4 to level 5 is therefore a step in waiting for memory, not in instructions.") with the numeric parentheses removed because the table carries them: "Level 5 goes further at that size: fewer cycles, a higher rate of instructions per cycle and fewer loads sent to the last-level cache. It executes more L1 loads than level 4, ..." (the only wording edits in this paragraph: the three numbers become words because the table shows them; do not add comparison words beyond "fewer/higher/more" that the counts-tests cover: the level 5 numbers are lower cycles, higher IPC, fewer last-level loads than level 4, asserted by the tests in `claims.test.mjs` named 'the event counts at the largest size'; the implementer must read them and confirm).

Keep, unchanged, the data-TLB paragraph and the "Two limits matter" paragraph. Allowed multiset change: `{{count l1d_misses streaming}}` and `{{count l1d_loads simd}}` added once each; `{{count cycles ...}}`, `{{count ipc ...}}`, `{{count llc_loads ...}}`, `{{count l1d_loads ...}}` otherwise each stay (they move into the tables); the `{{ms ...}}` pair stays in prose; `{{countratio ...}}` stay.

- [ ] **Step 4: "The twist": level 4 against level 5 by thread count.** In the paragraph that begins "[Level 5](crate::streaming) exists to make the problem possible", replace the sentence "At n = {{env largest}} it takes {{ms streaming t=1}} on one thread, ... {{ms streaming t=8}} on eight, each ahead of level 4's time with the same threads, though by little: ..." with:

```markdown
At n = {{env largest}} it was ahead of level 4 at every thread count, though by little:

| threads | level 4 | level 5 |
|---|---|---|
| 1 | {{ms packed t=1}} | {{ms streaming t=1}} |
| 2 | {{ms packed t=2}} | {{ms streaming t=2}} |
| 4 | {{ms packed t=4}} | {{ms streaming t=4}} |
| 8 | {{ms packed t=8}} | {{ms streaming t=8}} |

Level 4 gets most of the way from level 3 to level 5 at every thread count.
```

(Keep "At the two smaller sizes level 5 loses the lead: ..." after the table.) The sentence "each ahead of level 4's time with the same threads" is covered by the test 'level 5 stays ahead of level 4 at the largest size' (confirm in the report). Allowed multiset change: none.

- [ ] **Step 5: Sentence accounting, multiset diff and verification** as in Task 1 (lost sentences: only the pure number-list sentences named; reworded: the Level 5 counts sentence and the one in Step 4; the report lists both). Run the tests, build and check, and `grep -c "{{" web/site/dist/discussion/index.html` must print 0.

- [ ] **Step 6: Commit.** `git add docs/paper/discussion.md && git commit -m "tabulate the packing, counter and twist figures"`.

---

### Task 3: "The part left open": tables, and the open question first

**Files:**
- Modify: `docs/paper/discussion.md` (section `# The part left open: what stops the threads`)

- [ ] **Step 1: Save the baseline.**

- [ ] **Step 2: Thread scaling table.** Replace the second paragraph's list sentences ("Level 3 takes {{ms simd t=1}} on one thread, ... level 5 {{ms streaming t=4}} and {{ms streaming t=8}}. Level 2 gains a little more from them ({{ms cache_friendly t=4}} to {{ms cache_friendly t=8}}), far less than from its first four.") with a lead and a table; keep "almost nothing from the second four threads" and "For these four levels most of the scaling stops where the physical cores run out, not where the hardware threads do." Text:

```markdown
Levels 2 to 5 behave differently from level 1. At n = {{env largest}}, most of their scaling
stops where the physical cores run out, not where the hardware threads do:

| threads | level 2 | level 3 | level 4 | level 5 |
|---|---|---|---|---|
| 1 | {{ms cache_friendly t=1}} | {{ms simd t=1}} | {{ms packed t=1}} | {{ms streaming t=1}} |
| 2 | {{ms cache_friendly t=2}} | {{ms simd t=2}} | {{ms packed t=2}} | {{ms streaming t=2}} |
| 4 | {{ms cache_friendly t=4}} | {{ms simd t=4}} | {{ms packed t=4}} | {{ms streaming t=4}} |
| 8 | {{ms cache_friendly t=8}} | {{ms simd t=8}} | {{ms packed t=8}} | {{ms streaming t=8}} |

Levels 3 to 5 gain almost nothing from the second four threads. Level 2 gains a little more
from them, far less than from its first four.
```

(The old sentence "For these four levels most of the scaling stops ..." is kept in the lead; "almost nothing from the second four threads" now says "Levels 3 to 5" to match the test; the implementer must confirm against 'levels 2 to 5 stop scaling at the physical cores; level 2 gains a little more from the second four'.) Allowed multiset change: `{{ms cache_friendly t=2}}`, `{{ms packed t=1}}`, `{{ms packed t=2}}`, `{{ms streaming t=1}}`, `{{ms streaming t=2}}` added once each; `{{ms cache_friendly t=1}}` may be added once.

- [ ] **Step 3: Probe table.** In the paragraph that begins "The Methods say that threads stop helping when something they share is used up", keep the first two sentences; replace the sentences that list the triad, peak and fraction numbers with a lead and a table; keep every sentence from "These are the rates that one test loop achieved, not the most the cores can do." on, except that the two share figures move into the table:

```markdown
The reference run also measured two rates of the machine directly, natively and with the same
thread counts. A bandwidth test (the STREAM triad, which streams three arrays far larger than
the caches) stops gaining at four threads, like the levels. An arithmetic test that never
leaves the registers kept gaining:

| threads | bandwidth test | arithmetic test | level 3 as a share of the arithmetic test |
|---|---|---|---|
| 1 | {{triad t=1}} | {{peak t=1}} | {{frac simd t=1}} |
| 4 | {{triad t=4}} | {{peak t=4}} | {{frac simd t=4}} |
| 8 | {{triad t=8}} | {{peak t=8}} | {{frac simd t=8}} |
```

then "These are the rates that one test loop achieved, not the most the cores can do. So with eight threads the test found more arithmetic than the levels use. ..." through the end of the paragraph, unchanged (the sentences "Level 3 reaches {{frac simd t=1}} of the test's one-thread rate on one thread, and {{frac simd t=8}} of its eight-thread rate on eight." may be dropped because the table carries them; list that as a lost sentence). Allowed multiset change: `{{frac simd t=4}}` added once; `{{frac simd t=1}}` and `{{frac simd t=8}}` move into the table (one each), `{{triad ...}}`/`{{peak ...}}` move into the table.

- [ ] **Step 4: Throughput-by-size table.** Replace the list sentences of the last paragraph ("Level 3 on four threads reaches {{gflops simd t=4 n=512}} at n = 512, ... a smaller fall than level 3's.") with a lead and table; keep the interpretation sentences ("The throughput of the fastest levels also depends on the problem size, and here too the change falls between n = 512 and n = 1024.", "The fall is therefore mostly a fall with several threads ...", "That fits a reading ...", "The one-thread fall that remains is the part that packing removes ... a smaller fall than level 3's."):

```markdown
| n | level 3, four threads | level 3, one thread | level 4, one thread |
|---|---|---|---|
| 512 | {{gflops simd t=4 n=512}} | {{gflops simd t=1 n=512}} | {{gflops packed t=1 n=512}} |
| 1024 | {{gflops simd t=4 n=1024}} | {{gflops simd t=1 n=1024}} | {{gflops packed t=1 n=1024}} |
| {{env largest}} | {{gflops simd t=4}} | {{gflops simd t=1}} | {{gflops packed t=1}} |
```

Allowed multiset change: `{{gflops packed t=1 n=1024}}` added once.

- [ ] **Step 5: Accounting and verification** as before. Then **commit:** `git add docs/paper/discussion.md && git commit -m "tabulate the open question's figures"`.

---

### Task 4: Browser section: tables, and move it after the open question

**Files:**
- Modify: `docs/paper/discussion.md` (section `# Browser against native`)

- [ ] **Step 1: Save the baseline.**

- [ ] **Step 2: One table for the largest size.** Replace the lists of times in the paragraphs that begin "At n = {{env largest}}, the same Rust code, compiled to WebAssembly", "Levels 0 and 1 are a different case" (largest size only) and "The two browser builds differ in more than threads" with ONE table, and keep every other sentence. The table (place it after the first paragraph's opening sentence, with the lead "At n = {{env largest}}, on one thread:"):

```markdown
| level | native | browser, single-threaded build | browser, threaded build |
|---|---|---|---|
| 0 | {{ms naive}} | {{ms naive lite}} | {{ms naive threads}} |
| 1 | {{ms threaded t=1}} | {{ms threaded lite}} | {{ms threaded threads t=1}} |
| 2 | {{ms cache_friendly t=1}} | {{ms cache_friendly lite}} | {{ms cache_friendly threads t=1}} |
| 3 | {{ms simd t=1}} | {{ms simd lite}} | {{ms simd threads t=1}} |
| 4 | {{ms packed t=1}} | {{ms packed lite}} | {{ms packed threads t=1}} |
| 5 | {{ms streaming t=1}} | {{ms streaming lite}} | {{ms streaming threads t=1}} |
```

Then keep these sentences, in the page's current order, in the paragraphs around the table: "The same Rust code, compiled to WebAssembly and run in {{env firefox}}, was slower than the native build at levels 2 to 5, by an amount that depends on the level." and "The two levels written around vector registers, 3 and 4, come closest to native speed. Both builds use 128-bit vectors, ..." (through "...but not why levels 2 and 5 lose more. Levels 3 and 4 came closest of the four at every size."); "Levels 0 and 1 are a different case. At n = {{env largest}} they ran about as fast in the browser as natively." and "At n = 1024 both were much slower in the browser: level 0 took {{ms naive lite n=1024}} against {{ms naive n=1024}}, level 1 {{ms threaded lite n=1024}} against {{ms threaded t=1 n=1024}}. The run does not show why the gap closes at the largest size."; "The gaps between the levels are therefore not the same in the two environments. ..." (keep its sentences; the numbers `{{ms packed lite}} against {{ms simd lite}}` and `{{ms streaming lite}}` may stay in prose); "With threads, level 3 comes within about an eighth of native speed: ... {{ms simd threads t=4}} on four threads, {{ms simd threads t=8}} on eight. ..."; and "The two browser builds differ in more than threads. The single-threaded build was compiled with {{env rustc_lite}}, the threaded one, like the native code, with {{env rustc_threads}}, and only the threaded build uses shared memory. On one thread, at n = {{env largest}}, the threaded build was faster than the single-threaded one for levels 0, 2, 4 and 5, and about the same for levels 1 and 3. Which of the differences between the builds causes which result is not something this experiment can separate." (the parenthetical numbers after "levels 0, 2, 4 and 5" and "levels 1 and 3" go; the table carries them).

Allowed multiset change: none required; each placeholder in the removed lists reappears once in the table. If a placeholder of the old text now appears fewer times because the table holds it once instead of twice, report it.

- [ ] **Step 3: Move the section.** Move the whole `# Browser against native` section to sit AFTER the section `# The part left open: what stops the threads` and BEFORE `# What the measurements cannot say`. Add one lead sentence under its heading, exactly: `A side trip: the same code, compiled to WebAssembly, in a browser.` Fix any dangling reference the move creates: in particular the sentence "At n = {{env largest}} it also stops improving after four threads, like the native build (see the next section)" must now read "(see the section above)"; search for other "next section", "below" and "above" and fix them with the shortest edit; list each.

- [ ] **Step 4: Accounting and verification** as before (lost sentences: only the list parentheticals named; reworded: the "see the section above" connective). Check that the in-page anchor still resolves (`web/dev/node.sh site npm run check`). **Commit:** `git add docs/paper/discussion.md && git commit -m "tabulate the browser figures and move the side trip"`.

---

### Task 5: Gather each section's caveats into one labelled paragraph

**Files:**
- Modify: `docs/paper/discussion.md`

The ADHD review found 21 hedges inside the claims. In each findings section, move the sentences that say what the data cannot show into one closing paragraph that begins with the bold lead `**What this does not show.**`. The claim sentences stay where they are, so a reader can read the claims straight through and read the caveats as a unit. Move sentences whole and in their original order; do not rewrite them. If a moved sentence starts with a pronoun or "But", add the shortest antecedent (list each such edit).

- [ ] **Step 1: Save the baseline.**

- [ ] **Step 2: Move these sentences** (identified by their first words) to a closing `**What this does not show.**` paragraph at the end of the section named:
  - `# The culprit: memory`: "the run did not measure that" (the end of the first paragraph's sentence "A plausible reading is that ..."; keep the reading, move only the clause by turning it into its own sentence "The run did not measure that."), "Either could explain the fall, and the data cannot tell them apart; nor can they rule out ...", "The counts were taken at two sizes, neither of them between n = 512 and n = 1024, ...".
  - `# Cleaning up: registers and packing`: "The experiment does not show how much of level 2's speed already comes from the compiler vectorising its inner loop, ...".
  - `# What the counters show`: "the counts do not test that" (end of the "One reading is that the misses of level 3 were served from the L2 ..." sentence: same treatment as above), and from the "This is the strongest evidence in this paper for a cause, and it still has limits: ..." sentence the part after the colon becomes its own sentence in the paragraph; the existing "Two limits matter. ..." paragraph becomes the body of this section's labelled paragraph (add the bold lead to it and keep its sentences).
  - `# The twist: streaming`: "They do not show that cache-set conflicts are the mechanism. The strided reads also touch more cache lines and more pages for the same data, and the run cannot separate those effects. A smaller part of level 5's lead, the step from level 4 to level 5, is still not explained: the counts above show less waiting for memory, not why."
  - `# The part left open: what stops the threads`: from the probe paragraph, "That suggests the arithmetic units themselves are not what runs out, but it does not show that main memory is." through "...The counting run above used one thread, so it cannot tell these explanations apart either." (keep "So with eight threads the test found more arithmetic than the levels use." in the claim text; move the rest, including the 1 GB estimate and its hedge, so the open question's own evidence reads straight); and "but the run did not measure it" in the throughput paragraph (own sentence "The run did not measure it.").
  - `# Browser against native`: the sentences that say the run does not show why ("The run does not show why the gap closes at the largest size.", "The reference run does not show why: ...", "The reference run does not say why the threaded build comes so close here.", "Which of the differences between the builds causes which result is not something this experiment can separate.") go into the section's labelled paragraph.
  - `# The answer does not change`, `# The first suspect: the cores`: no change.

- [ ] **Step 3: Check that each claim paragraph still stands alone** (read it without the moved sentences: no dangling "that", "this", "these"); fix with the shortest connective and list each fix. Check that no claim sentence was weakened or widened.

- [ ] **Step 4: Sentence accounting and verification.** The sentence multiset must be unchanged except for the bold leads, the split of the clauses named above ("The run did not measure that.", "The counts do not test that.", "The run did not measure it.", the post-colon sentence) and the listed connectives. The placeholder multiset must be identical to the Task 4 result. Run the tests, build and check.

- [ ] **Step 5: Commit.** `git add docs/paper/discussion.md && git commit -m "gather the discussion's caveats under one label"`.

---

### Task 6: Verify the whole page and re-measure

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full verification.** `web/dev/node.sh site npm test`, `web/dev/node.sh site npm run build`, `web/dev/node.sh site npm run check`; `grep -c "{{" web/site/dist/discussion/index.html` must print 0; `grep -c "<table" web/site/dist/discussion/index.html` must print the number of tables added (10 or 11: culprit 2, cleaning 1, counters 2, twist 1, open 3, browser 1 = 10).

- [ ] **Step 2: Re-measure.** Write a small script (scratchpad) that reports, for `docs/paper/discussion.md`: words, mean and 90th-percentile sentence length (treat `{{...}}` as one token; ignore table rows and headings), the share of sentences over 30 words, the longest paragraph (words), and the maximum placeholders in a single non-table paragraph. Compare with the baseline of the ADHD review (3,387 words; mean sentence 23.7; 24% of sentences over 30 words; longest paragraph 326 words; up to 18 placeholders in one paragraph) and report the new numbers beside the old.

- [ ] **Step 3: Read it in order** and confirm: each section opens with its claim; no paragraph over about 150 words remains outside tables, or the exceptions are listed; the page order is: answer, first suspect, culprit, cleaning up, counters, twist, open question, browser side trip, limits; every `crate::` link resolves; nothing says what limits the threads; the probe is a test, not "the limit".

- [ ] **Step 4: Report** what changed, the before/after numbers, and any sentence reworded, to the user (with the real outputs, including any failure).
