# Trim the Prose: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The controller must hand every implementer and reviewer the sections **Global Constraints**, **Tooling** and **Tested claims** together with its task: the tasks rely on them.

**Goal:** Cut the paper's filler, repeats and hedges so that each page says its point once and is easier to read, without losing a fact or adding a claim. Pass 1 is the back of the paper (Conclusion, Discussion, Results); pass 2 the front (Introduction, Primer) and the six level chapters. The user's verdict on the old abstract, "a lot of words that say nothing and are still hard to read", is the standard; the rewritten `docs/paper/abstract.md` (question, method, answer) is the model and is not edited here. The user asked: "Run both passes. Shrink the conclusion."

**Architecture:** Prose edits only, to `docs/paper/{conclusion,discussion,results,introduction,primer}.md` and `docs/levels/*.md`. The edits come from three editors' reports (`.superpowers/review/back.md`, `front.md`, `levels.md`), turned into exact Find → Replace pairs plus a "cut X, keep Y" rule for the rest. Each task is checked mechanically (placeholder multiset, word and long-sentence counts, fenced blocks, headings, the site tests, build and check, figure placement, doctests) and by a reviewer against a facts-kept checklist.

**Tech Stack:** Markdown; Astro site under `web/site` (Node only through `web/dev/node.sh`); `node --test`; `cargo test --doc`; Python 3 helper scripts in the scratchpad.

**Dry run.** Every Find string in this plan was matched (exactly once) and every replacement applied on a scratch copy of the repository before the plan was written. With all eight tasks applied: `npm test` 186/186, `npm run build` and `npm run check` PASS, all figure placements correct (one of them, the Results' native tables, is fixed by Task 3), `cargo test --doc` 30 passed, `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps` clean. The word counts it gave are the targets below.

## Global Constraints

Binding rules (from the brief, verbatim in substance):

- **Prose only.** Code, data, figures, demos and `web/site/src/data/results.json` are untouched. Do not edit `web/site/site.config.mjs` (`levelStory`, `levelFindings`, `insertions`, `blocksAfter`, `links`), any test, or any `.rs` file. The one allowed test edit is the `unmarked` list in `web/site/src/plugins/remark-glossary.test.mjs` (see the glossary rule); the dry run needed none.
- **Every number stays a `{{...}}` placeholder.** Move or remove placeholders, never retype a number. No placeholder may be added. Every placeholder a task removes is listed in that task; any other difference fails the task.
- **`web/site/src/results/claims.test.mjs`:** every comparison stated in words must stay covered at the same scope (size, thread count, environment, levels) and say no more than its test. If a cut would orphan a test (leave its claim stated nowhere), keep the claim. Test titles that name a page which no longer states the claim are left as they are (tests are not edited); Task 8 lists them.
- **Never say what limits threads at four.** The Discussion's sentence "That makes main-memory bandwidth look an unlikely limit, for level 5 at least, ..." is reworded (Task 2) to: the estimate gives no sign that main-memory bandwidth is used up, though it cannot rule it out. The test that guards that estimate is 'the hardware probe: triad stops gaining at four threads, ...' (its last two assertions: about 1 GB of tile reads, under a tenth of level 5's four-thread time at the four-thread triad rate).
- **The arithmetic probe is a "test loop"** (or "arithmetic test"), never "peak", "limit" or "ceiling" in prose. (Placeholder names such as `{{peak t=1}}` are data keys, not prose.)
- **`docs/levels/*.md` are Rust doc modules:** no `{{placeholders}}`, no benchmark numbers, and no measured results; code blocks are doctests and every fenced block (rust, text, sh) stays byte-identical and in the same order; the first paragraph is the rustdoc summary and keeps its bold lead `**Level N, of levels 0 to 5.**`; run `cargo test --doc` after any level edit. The packed chapter's measured-result sentence ("At the two largest sizes the copy did earn its cost back") is removed. A level page may not link `crate::primer`, `crate::discussion` or any paper page (rustdoc has none); "the project's website" in plain text is the only way to point there.
- **Paper pages** (`docs/paper/*.md`) have `{{...}}` placeholders resolved at build; an unresolved one fails the build.
- **Glossary:** `web/site/src/plugins/remark-glossary.mjs` is generated from the primer's `# Terms used in the chapters` table, and `remark-glossary.test.mjs` asserts the exact list and ORDER of its terms and has a dead-term test. Do NOT delete glossary rows. Do NOT reorder them (reordering changes the asserted order, so the test would fail; it is allowed only if the tests pass unchanged, and they do not). If a cut removes the only use of a term the test lists, prefer keeping a sentence that uses it; failing that, add the term to the test's `unmarked` list with the reason. Terms with a single use in the chapters, which the tasks below keep on purpose: "prefetcher" and "memory page(s)" (packed.md), "FMA" and "broadcast" and "hit" (simd.md), "work queue" (threaded.md), "register blocking" (conclusion.md, Further reading), "L3" and "STREAM triad" (discussion.md).
- **Story boxes** (`levelStory` in `web/site/site.config.mjs`) are generated and checked by `web/site/src/results/story.test.mjs`. If a chapter's opening changes, the box must still be accurate. Do not make the box repeat the chapter opening more than it already does. The boxes are not edited by this plan (each was checked against the new openings: all still accurate).
- **Rewrapping:** never join lines of a Markdown list, table or heading. After any rewrap, every bullet, numbered item, table row and heading still starts its own line; keep a blank line before and after every list, table and heading. Rewrap edited paragraphs to about 100 columns, no trailing spaces.
- **When restructuring, move whole sentences; never retype a claim.** The only rewordings allowed are the Replace texts in this plan.
- **Keep headings that `site.config.mjs` uses to splice insertions** (`findingsHeading`, the level chapters' first headings, the demos' and figures' headings) unchanged, and keep the number of blocks between such a heading and a `blocksAfter` insertion unchanged (list below).
- **check-dist rules** (`web/site/check-dist.mjs`): one `<h1>` per page (paper `#` headings become `<h2>`; never write a page title), the demo counts per chapter, no `crate::` text in the built site, no `{{` leaking, the Results page still links to the playground and has exactly the tables and charts `site.config.mjs` inserts.
- **Node runs only via `web/dev/node.sh site npm test|run build|run check`.**

Derived constraints:

- **Headings.** The only headings this plan deletes are: in the Conclusion `# The line-up`, `# The verdict`, `# What it means, and what it does not`; in the Discussion `# The answer does not change`; in the Results `# Noise and limits`; in the Introduction `# What this is not`. No other heading is renamed or deleted. In particular keep: `# The part left open: what stops the threads` (the Conclusion links to its anchor after Task 1), `# What the counters show` (linked inside the Discussion), `# What was measured` and `# Native` (the Results skip line links to them), every Results heading (figures are spliced under them), the primer's `# Walking along a row, walking down a column` and `# Terms used in the chapters`, the Introduction's `# A minute or a second` and `# Mechanical sympathy` (it explains the site's title, "Mechanical sympathy"), and every level heading. No inbound link to a deleted heading exists (checked with `grep -rnoE "(results|discussion|conclusion|introduction|primer)/#|crate::[a-z_]+#|\(#[a-z0-9-]+\)" docs web/site/src web/site/*.mjs README.md CONTRIBUTING.md`: only `#what-the-counters-show`, `#native`, `#what-was-measured`, all kept).
- **Block counts under `blocksAfter` insertions** (the figure is spliced at heading + 1 + blocksAfter, counting earlier insertions at the same heading): packed `What changed from level 3` (6: video, two paragraphs, diagram, two paragraphs); cache_friendly `Change 2: cache blocking` (5: demo, two paragraphs, code, paragraph); simd `The micro-kernel` (5: demo, paragraph, two code blocks, paragraph); primer `Walking along a row, walking down a column` (1); Results `Native`, `Throughput against matrix size, native`, `Thread scaling, native`, `In the browser`, `Hardware event counts` (2 each) and `Thread scaling in the browser` (1). Edits under those headings rewrite paragraphs in place. The one deliberate change: Task 3 deletes the one-line paragraph under `# Native` ("This section asks ..."), which moves the native tables from before their intro paragraph (where they sit today, a pre-existing misplacement) to after it. `placement.py` (Tooling) checks all ten.
- **Links.** No new `crate::` target. The one new link is the Conclusion's relative link `../discussion/#the-part-left-open-what-stops-the-threads` (a plain relative URL, so the rustdoc link rewriter leaves it alone; the Conclusion is not rendered by rustdoc).
- **Workspace and commits.** Work on branch `trim-prose` (the plan is committed there). One commit per task, a short one-line message, then a blank line and `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No merge, no push.
- **Verification commands** (repository root):
  - `web/dev/node.sh site npm test` (186 pass at the start; the count must not change)
  - `web/dev/node.sh site npm run build`, then `web/dev/node.sh site npm run check` (`check-dist: PASS (13 pages)`)
  - `python3 -I $SCRATCH/placement.py` (after the build; all `ok`)
  - `cargo test --doc` (30 passed) and `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps` (clean) after any level edit
  - `$SCRATCH` is your scratchpad directory (set it in each shell: `SCRATCH=<your scratchpad>`).

## Tooling

Save these two scripts in `$SCRATCH` at the start of any task (they write nothing in the repository).

`$SCRATCH/prose.py`: word count (as `wc -w`), sentences over 30 words (outside code, tables and headings; a placeholder counts as one word), placeholder multiset diff, headings removed/added, fenced blocks identical, primer terms table identical, and lines that look like a joined list, table row or heading.

~~~python
"""Checks for a prose-trimming pass. Run with python3 -I.

  prose.py stats FILE        words (as wc -w), sentences over 30 words, placeholders
  prose.py diff OLD NEW      the same for both, plus: placeholders removed and added,
                             headings removed and added, fenced blocks and the primer's
                             terms table unchanged, lines that look like a joined list,
                             table or heading
"""
import re
import sys
from collections import Counter

PH = re.compile(r"\{\{[^}]*\}\}")


def fences(text):
    return re.findall(r"^```.*?^```", text, flags=re.S | re.M)


def terms_table(text):
    m = re.search(r"^# Terms used in the chapters\n\n((?:\|.*\n)+)", text, flags=re.M)
    return m.group(1) if m else None


def prose_chunks(text):
    """Paragraphs, list items and blockquotes, outside fences, tables, headings and html."""
    text = re.sub(r"^```.*?^```", "", text, flags=re.S | re.M)
    chunks, cur = [], []
    for line in text.split("\n"):
        s = line.strip()
        starts_item = re.match(r"(- |\d+\. )", s)
        if not s or s.startswith(("#", "|", "<")) or starts_item:
            if cur:
                chunks.append(" ".join(cur))
            cur = [re.sub(r"^(- |\d+\. )", "", s)] if starts_item else []
            continue
        cur.append(re.sub(r"^> ?", "", s))
    if cur:
        chunks.append(" ".join(cur))
    return [c for c in chunks if c]


def sentences(text):
    out = []
    for chunk in prose_chunks(text):
        chunk = PH.sub("X", chunk)
        out += [s for s in re.split(r"(?<=[.?!])\s+(?=[A-Z\[*(`_])", chunk) if s.strip()]
    return out


def stats(text):
    long = [s for s in sentences(text) if len(s.split()) > 30]
    return {"words": len(text.split()), "long": long, "ph": Counter(PH.findall(text))}


def show(name, text):
    st = stats(text)
    print(f"{name}: {st['words']} words, {len(st['long'])} sentences over 30 words, "
          f"{sum(st['ph'].values())} placeholders")
    return st


def suspicious(text):
    """Lines where a list item, table row or heading seems to have been joined onto prose."""
    bad = []
    for n, line in enumerate(text.split("\n"), 1):
        if re.search(r"\S\s+(- \*\*|\d+\. \*\*|#{1,3} [A-Z])", line) and not line.lstrip().startswith("|"):
            bad.append((n, line))
        if "|" in line and not line.lstrip().startswith("|") and line.count("|") >= 3:
            bad.append((n, line))
    return bad


def main():
    if sys.argv[1] == "stats":
        st = show(sys.argv[2], open(sys.argv[2], encoding="utf8").read())
        for s in st["long"]:
            print(f"  LONG ({len(s.split())}): {s[:110]}")
        return
    old, new = (open(p, encoding="utf8").read() for p in sys.argv[2:4])
    a, b = show("before", old), show("after ", new)
    print("placeholders removed:", dict(a["ph"] - b["ph"]) or "none")
    print("placeholders ADDED:  ", dict(b["ph"] - a["ph"]) or "none")
    heads = lambda t: [l for l in t.split("\n") if l.startswith("#") and not l.startswith("#[")]
    ha, hb = heads(re.sub(r"^```.*?^```", "", old, flags=re.S | re.M)), heads(re.sub(r"^```.*?^```", "", new, flags=re.S | re.M))
    print("headings removed:", [h for h in ha if h not in hb] or "none")
    print("headings added:  ", [h for h in hb if h not in ha] or "none")
    print("fenced blocks identical:", fences(old) == fences(new))
    if terms_table(old) is not None:
        print("terms table identical:", terms_table(old) == terms_table(new))
    print("suspicious joined lines:", suspicious(new) or "none")
    for s in b["long"]:
        print(f"  LONG ({len(s.split())}): {s[:110]}")


main()
~~~

`$SCRATCH/placement.py`: run from the repository root after the build; checks that each figure spliced in with `blocksAfter` sits right after the paragraph that introduces it.

~~~python
"""Checks, in the built site, that each figure inserted by blocksAfter sits right after the
paragraph that introduces it. Run from the repository root with python3 -I, after the build.
Usage: placement.py [page ...]   (default: every page below)"""
import re
import sys

FIGURE = r'<figure class="(results-figure|chart)"'
# page, heading id, text of the paragraph the figure must follow, figure marker (regex),
# text that must come after the figure (or None)
CHECKS = [
    ("results", "native", "The tables give every level", FIGURE, None),
    ("results", "throughput-against-matrix-size-native", "The chart gives each level", FIGURE, None),
    ("results", "thread-scaling-native", "with the speedup over one", FIGURE, None),
    ("results", "in-the-browser", "The same cases ran in", FIGURE, None),
    ("results", "hardware-event-counts", "show what the hardware did differently", FIGURE, "A separate native run counted"),
    ("results", "thread-scaling-in-the-browser", "The lite build has one", FIGURE, None),
    ("levels/packed", "what-changed-from-level-3", "is passed with a row length of", r"What to look for\.</strong> The same strip of B", None),
    ("levels/cache_friendly", "change-2-cache-blocking", "which fits in a typical 32 KiB", r"What to look for\.</strong> Compare the two counts", None),
    ("levels/simd", "the-micro-kernel", "This is the central idea of every", r"What to look for\.</strong> The arithmetic is the same", None),
    ("primer", "walking-along-a-row-walking-down-a-column", "Each row is two cache", r"Walking along a row: 8 values used", None),
]
TERM = re.compile(r'<span class="term"[^>]*><span>([^<]*)</span><span class="tip"[^>]*>[^<]*</span></span>')

pages = sys.argv[1:]
failed = False
for page, heading, before, marker, after in CHECKS:
    if pages and page not in pages:
        continue
    html = TERM.sub(r"\1", open(f"web/site/dist/{page}/index.html", encoding="utf8").read())
    h = html.find(f'id="{heading}"')
    end = html.find("<h2", h + 1)
    end = len(html) if end == -1 else end
    a = html.find(before, h)
    m = re.compile(marker).search(html, h)
    ok = h != -1 and -1 < a < end and m is not None and a < m.start() < end
    # nothing but the rest of the intro paragraph may stand between the text and the figure
    gap = html[a:m.start()] if ok else ""
    ok = ok and gap.count("<p") == gap.count('<p class="st-lookfor"') and "<h" not in gap
    if ok and after is not None:
        z = html.find(after, h)
        ok = m.start() < z < end
    print("ok  " if ok else "FAIL", page, heading, "|", before)
    failed |= not ok
sys.exit(1 if failed else 0)
~~~

On `trunk` today `placement.py` prints FAIL for `results native` (the misplacement Task 3 fixes) and for `results hardware-event-counts` (its anchor text is the sentence Task 3 rewrites); everything else is `ok`.

**How to apply a Find → Replace pair.** Find, Replace and Delete texts are quoted between « and » (the quoted text may itself contain backticks). The Find text is quoted as one line; the file wraps it across lines, so match it by its words (whitespace is not significant). It occurs exactly once. Replace it with the Replace text, then rewrap the paragraph it sits in (never joining list, table or heading lines). A Replace of "(nothing)" deletes the Find text; when that empties a line or a list item, delete the line, and leave exactly one blank line between blocks.

## Tested claims

Where each test in `web/site/src/results/claims.test.mjs` is stated in words after this plan (the list Task 8 re-checks; no test may end up with no sentence):

| test (title start) | stated after this plan in |
|---|---|
| the sizes the prose names were measured | Discussion "Four sizes" bullet; "the second four threads" (Discussion part left open) |
| level 5 is faster than level 3 ... two largest sizes | Discussion twist; streaming.md cost bullet (hedged: "may ... offset the copy") |
| at the smaller sizes level 5 loses that lead | Discussion twist |
| level 4 (packing) against level 3 | Discussion cleaning up; level 4 strip (site config) |
| level 5 stays ahead of level 4 ... most of the way | Discussion twist |
| level 5 on four threads, natively, is the fastest case | Discussion summary bullet and twist; Introduction level 5 paragraph; level 5 strip |
| the event counts were taken at two sizes ... same compiler | Results "Hardware event counts"; Discussion counters opening (sizes, one thread) |
| the event counts at n=1024 | Discussion counters |
| the event counts at the largest size | Discussion counters (incl. TLB and level 1's L1 loads) |
| levels 0 and 1 one-thread ... tight, level 1 no faster | Discussion first suspect |
| level 1 thread scaling | Introduction ("the second four bought almost nothing"); threaded.md next step; Discussion first suspect ("none of it comes close") |
| levels 2 to 5 stop scaling at the physical cores | Discussion summary bullet and part left open; Conclusion opening |
| most of the one-thread gain arrives with level 2 | Discussion summary and culprit; Introduction short-on-time line; Abstract |
| level 3 gains much less over level 2 | Discussion summary and culprit |
| the growth of level 2's gain after n=512 | Discussion culprit |
| the cache facts | Discussion culprit; primer column walk |
| level 3 four-thread throughput falls after n=512 | Discussion part left open |
| on one thread, level 4 loses less throughput | Discussion part left open |
| the hardware probe | Discussion part left open (with the reworded bandwidth sentence); Conclusion opening ("kept gaining"); Introduction test loop |
| browser against native | Discussion browser |
| the hook | Introduction test loop; naive.md opening and story box ("far from what the processor can do") |
| the first clue | Abstract; Introduction; Discussion; level 2 strip; story boxes |
| the verdict: the fastest case | Abstract |
| the opening | Introduction first section; Conclusion opening ("more than an order of magnitude": the test asserts over 30 s against under 2 s) |

---

## Pass 1: the back of the paper

### Task 1: Shrink the Conclusion

**Files:**
- Modify: `docs/paper/conclusion.md`
- Modify: `docs/paper/introduction.md` (one clause that describes the Conclusion)

**Interfaces:**
- Consumes: the Discussion heading `# The part left open: what stops the threads` (anchor `the-part-left-open-what-stops-the-threads`), which Task 2 keeps.
- Produces: a Conclusion of about 470 words with no placeholders; the opening sentence the editor asked for; a link into the Discussion's open-question section.

Keep: an opening lesson sentence, a pointer to the open question with a link, the four questions, "Beyond matrix multiplication", further reading, the playground once. Cut: "The line-up", "The verdict", "What it means, and what it does not", the opening question (it is the Abstract's).

- [ ] **Step 1: Baseline.** `mkdir -p $SCRATCH/before && cp docs/paper/conclusion.md docs/paper/introduction.md $SCRATCH/before/`; `python3 -I $SCRATCH/prose.py stats docs/paper/conclusion.md` (expect 1214 words, 13 sentences over 30 words, 10 placeholders).

- [ ] **Step 2: Link audit before deleting headings.** Run
  `grep -rn "the-line-up\|the-verdict\|what-it-means\|conclusion/#\|conclusion#" docs web/site/src web/site/*.mjs README.md CONTRIBUTING.md web/README.md | grep -v node_modules | grep -v docs/superpowers`
  and `grep -rn "verdict\|crate::conclusion" docs/paper docs/levels docs/introduction.md | grep -v "^docs/paper/conclusion.md"`.
  Expected: the first prints nothing; the second prints only `docs/paper/introduction.md` (the "gives the verdict" clause, fixed in Step 4, and the short-on-time line, which stays). Report any other hit and fix it in this task by pointing it at a heading that still exists.

- [ ] **Step 3: Replace everything before `# Four questions to take with you`** (the opening paragraph and the sections `# The line-up`, `# The verdict`, `# What it means, and what it does not`) with exactly:

```markdown
With the arithmetic unchanged, layout alone moved the running time by more than an order of
magnitude.

One question is left open. Threads stopped helping levels 3 to 5 where the physical cores ran
out, although a test of arithmetic alone kept gaining. These measurements do not say what limits
them; the Discussion's section
[The part left open](../discussion/#the-part-left-open-what-stops-the-threads) sets out what
they can and cannot say. The [playground](crate::playground) can show whether threads stop
helping at the physical cores on other hardware too.

```

(The first sentence is the editor's rewrite of the old "lesson" sentence. The second paragraph's second and third sentences are the Discussion's "Still open" bullet, word for word; the last sentence is the old page's last sentence, the only playground mention kept.)

- [ ] **Step 4: Two small edits.**
  - conclusion.md, Find: «tells you whether you were right, as the Discussion tried to do for these six levels.» Replace: «tells you whether you were right.»
  - introduction.md, Find: «the [Conclusion](crate::conclusion) gives the verdict and the part that stays open.» Replace: «the [Conclusion](crate::conclusion) gives the lesson and the part that stays open.» (Task 4 later removes this clause; this keeps the page true meanwhile.)
  - Everything else in `# Four questions to take with you`, `# Beyond matrix multiplication` and `# Further reading` stays word for word.

- [ ] **Step 5: Mechanical checks.** `python3 -I $SCRATCH/prose.py diff $SCRATCH/before/conclusion.md docs/paper/conclusion.md` must show:
  - about 472 words (target 450 to 600), at most 2 sentences over 30 words (both in unchanged sections);
  - placeholders removed, each once, exactly: `{{env largest}}`, `{{speedup cache_friendly/naive t=1}}`, `{{speedup simd/cache_friendly t=1}}`, `{{speedup streaming/naive t=4}}`, `{{speedup simd/naive}}`, `{{countratio l1d_misses simd/packed n=1024}}`, `{{countratio l1d_misses simd/packed}}`, `{{countratio cycles simd/packed}}`, `{{gflops simd lite}}`, `{{gflops simd t=1}}`; added: none;
  - headings removed exactly `# The line-up`, `# The verdict`, `# What it means, and what it does not`; added none; no suspicious lines.
  `python3 -I $SCRATCH/prose.py diff $SCRATCH/before/introduction.md docs/paper/introduction.md`: placeholders unchanged. `grep -c "playground" docs/paper/conclusion.md` prints 1.

- [ ] **Step 6: Tests, build, check.** `web/dev/node.sh site npm test` (186 pass), `web/dev/node.sh site npm run build`, `web/dev/node.sh site npm run check` (PASS). Then
  `grep -o 'href="../discussion/#the-part-left-open-what-stops-the-threads"' web/site/dist/conclusion/index.html` prints the link once, and `grep -c 'id="the-part-left-open-what-stops-the-threads"' web/site/dist/discussion/index.html` prints 1.

- [ ] **Step 7: Facts kept.** In your report, tick each with its location (heading + first words of the sentence):
  - [ ] layout (the arithmetic unchanged) moved the running time by more than an order of magnitude
  - [ ] threads stopped helping levels 3 to 5 where the physical cores ran out, while a test of arithmetic alone kept gaining
  - [ ] the measurements do not say what limits them; link to the Discussion's open section
  - [ ] the playground can show whether threads stop at the physical cores on other hardware (once on the page)
  - [ ] the primer's four questions, each with its level examples, and "they are the part of this paper that is not specific to matrix multiplication"
  - [ ] asking before measuring tells you where to look; measuring afterwards tells you whether you were right
  - [ ] "Beyond matrix multiplication", unchanged
  - [ ] the three further-reading entries, unchanged (Goto and van de Geijn keeps "register blocking" and "leaves the first matrix unpacked")
  Dropped on purpose (state where each lives): the line-up (Introduction, `# The line-up`); the verdict bullets (Discussion summary bullets and sections); "every case returned the same result" (Abstract, Discussion opening); one machine, one day (Discussion opening); counts from two sizes and one thread (Discussion `# What the counters show`); not a replacement for a tuned library (Introduction, last paragraph); the rough count of level 5's reads and what two hardware threads share (Discussion part left open).

- [ ] **Step 8: Review.** A reviewer subagent gets the before copy, the new file, `git diff`, this task and the Global Constraints, and checks: (1) every fact ticked above is present; (2) nothing new is claimed (every added sentence is one quoted in Step 3 or 4); (3) no number is typed; (4) words ≤ 600 and sentences over 30 words ≤ 2; (5) the page reads in order: lesson, open question with link, questions, beyond, reading. It reports PASS or FAIL with quotes.

- [ ] **Step 9: Commit.** `git add docs/paper/conclusion.md docs/paper/introduction.md && git commit -m "shrink the conclusion to the lesson, the open question and the questions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 2: Trim the Discussion

**Files:**
- Modify: `docs/paper/discussion.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the same sections (minus `# The answer does not change`), same 12 tables, the heading `# The part left open: what stops the threads` unchanged (the Conclusion links to it).

Rule for this page: the summary bullets and the tables carry the argument. Each section keeps its claim, its table, its reading and its "What this does not show". Cut what restates the summary bullets, restates a table in words, or describes the page; nothing else changes. The tables, the five summary bullets, the level legend and every "What this does not show" not named below are untouched.

- [ ] **Step 1: Baseline.** `cp docs/paper/discussion.md $SCRATCH/before/`; `python3 -I $SCRATCH/prose.py stats docs/paper/discussion.md` (expect 4394 words, 23 sentences over 30 words, 200 placeholders).

- [ ] **Step 2: Opening and `# The answer does not change`.** Find (from the paragraph after the level legend through the end of the section `# The answer does not change`, heading included):

```text
The sections below take these in order, with the event counts after the cleanups, and end with a side trip to the browser. Everything below refers to the reference run: one laptop, one day, one browser. Every figure is filled in from that run's committed data. Most sections open with their claim and then give a table; what the data cannot show is collected in a paragraph labelled "What this does not show". Where a sentence explains a difference rather than reports it, the sentence says so, and where the data cannot tell two explanations apart, the page says that too.

# The answer does not change

All {{env runs}} measured cases produced the same result for each matrix size, bit for bit: every level, every thread count, natively and in both browser builds. That is the premise of the comparison, and it is what separates it from a comparison of algorithms. No level does fewer multiply-adds than another, or different ones: each output element is still the sum of the same products, added in the same order. Every difference below is therefore a difference in how well the same arithmetic was fed to the hardware, and none of the speed was bought with a different answer.
```

Replace:

```markdown
The sections below take these in order, with the event counts after the cleanups, and end with
a side trip to the browser. Everything below refers to the reference run: one laptop, one day,
one browser. The laptop's caches are {{env l1d}} of L1 data cache and {{env l2}} of L2 per core,
and {{env l3}} of L3 shared by all the cores. Another CPU, with other cache sizes and another
memory system, would give other ratios. All {{env runs}} measured cases produced the same result
for each matrix size, bit for bit: every level, every thread count, natively and in both browser
builds.
```

(The cache sentence and "Another CPU ..." move here from the closing "One machine" bullet, Step 8; the last sentence is the old section's first. The cache sentence must stay: it is the only use of the glossary term "L3" in the chapters.)

- [ ] **Step 3: `# The first suspect: the cores`.**
  - Find: «At the larger size, with two threads it takes about half. With eight it is no slower than with four, and less than a tenth faster, though the eight threads are all the machine's hardware threads on {{env physical_cores}} physical cores.» Replace: «The eight threads are all the machine's hardware threads, on {{env physical_cores}} physical cores.» (Editor: the rest restates the table. The scaling claims stay in the Introduction and threaded.md.)
  - Find: «At n = 1024 level 1 also roughly halves its time with two threads and gains a little more from the second four. One plausible reading of that last gain is that level 1's inner loop spends much of its time waiting for memory, and a thread that is waiting leaves its core free for the thread that shares it. The measurements at n = 1024 are consistent with that and do not test it; those at n = {{env largest}} do not support it. And at n = {{env largest}} none of it comes close to [level 2](crate::cache_friendly) on a single thread: {{ms cache_friendly t=1}}, against level 1's {{ms threaded t=8}} on all eight threads. More cores were not the main thing the loop was missing.» Replace: «At n = {{env largest}} none of it comes close to [level 2](crate::cache_friendly) on a single thread: {{ms cache_friendly t=1}}, against level 1's {{ms threaded t=8}} on all eight threads.» (Cuts the untested hyperthreading reading and the repeat of the first bullet.)

- [ ] **Step 4: `# The culprit: memory` and `# Cleaning up: registers and packing`.**
  - Find: «This is what one would expect if the cause is the memory system, and two things about this machine's caches change between n = 512 and n = 1024.» Replace: «Two cache thresholds fall between n = 512 and n = 1024.»
  - Find: «Two smaller changes follow, each removing a cost the previous level still paid.» followed by the paragraph «Level 3's gain over level 2 is much smaller, though its micro-kernel [keeps a block of the output in vector registers](crate::simd).» Replace both with the one paragraph: «Level 3's micro-kernel [keeps a block of the output in vector registers](crate::simd).» (The smaller step is stated once, under the culprit's table.)

- [ ] **Step 5: `# What the counters show`.**
  - Find: «A separate run counted hardware events (with `perf stat`) for one multiplication per level on one thread, at n = 1024 and at n = {{env counters_n}}, user-space events only, in a binary built with the same compiler as the timed runs.» Replace: «A separate run counted hardware events for one multiplication per level on one thread, at n = 1024 and at n = {{env counters_n}}; the [Results](crate::results) give the method.» (The method, including "same compiler", stays on the Results page.)
  - Find: «So on one thread the faster time comes with fewer cycles and fewer loads that left the L2, which is what the reading that the cost lies in reading the second matrix in place predicted.» Replace: «On one thread, level 4's shorter time comes with fewer cycles and fewer loads past the L2, as predicted if the cost was reading the second matrix in place.»
  - Find: «Level 5 goes further at that size in cycles: fewer cycles and a higher rate of instructions per cycle.» Replace: «At that size level 5 needs fewer cycles still, at a higher rate of instructions per cycle.» (Keeps "at that size": the test checks the largest size only.)
  - Find: «so they say nothing about why the gains shrink with more threads.» Replace: «so they say nothing about why the gains shrink with more threads. The reference run did not count memory traffic, the use of the execution units, anything with several threads running, or anything in the browser.» (Moved from the "Explanations are interpretations" bullet, Step 8.)

- [ ] **Step 6: `# The twist: streaming` and `# The part left open: what stops the threads`.**
  - Find: «Level 5 was built for matrices that do not fit in memory, not for speed, and on four threads» Replace: «[Level 5](crate::streaming) was built for matrices that do not fit in memory, not for speed, and on four threads» (the link moves here from the next cut).
  - Find: «The [level 5](crate::streaming) chapter says it was built to make the problem possible, not to make it fast. The reference run» Replace: «The reference run»
  - Find: «Level 4 also helps explain the twist. One reading offered for level 5's lead was this. Its small buffers» Replace: «One reading of level 5's lead is that its small buffers»
  - Delete the paragraph that opens `# The part left open: what stops the threads`: «One question is not settled by these measurements, and it is the most interesting one: threads stopped helping levels 3 to 5 where the physical cores ran out, although a test of arithmetic alone kept gaining.» (It repeats the "Still open" bullet; the section now opens "Levels 2 to 5 behave differently from level 1.") Keep the heading text unchanged.
  - Find: «A rough count, not a measurement: level 5 at n = {{env largest}} reads its input tiles about 1 GB worth in all, even if every tile came from main memory, and at the triad's {{triad t=4}} that would take under a tenth of its {{ms streaming t=4}} on four threads.» Replace: «Rough estimate: even if every tile came from main memory, level 5 at n = {{env largest}} reads about 1 GB of input tiles in all. At the triad's {{triad t=4}} that would take under a tenth of its {{ms streaming t=4}} on four threads.» (Keeps "would": it is an estimate.)
  - Find: «That makes main-memory bandwidth look an unlikely limit, for level 5 at least, but the count is an estimate and the triad is one access pattern among many, so the data cannot rule it out.» Replace: «For level 5, the estimate gives no sign that main-memory bandwidth is used up, though it cannot rule it out: the count is an estimate, and the triad is one access pattern among many.» (Binding rule: never say what limits threads at four. Guarded by 'the hardware probe' test, last two assertions.)

- [ ] **Step 7: `# Browser against native`.**
  - Find: «That is a reason to expect them to travel well; the experiment shows that they do, but not why levels 2 and 5 lose more. Levels 3 and 4» Replace: «That is a reason to expect them to travel well. Levels 3 and 4»
  - Replace the whole paragraph that begins `**What this does not show.** The run does not show why the gap for levels 0 and 1 closes` (through `is not something this experiment can separate.`) with:

```markdown
**What this does not show.** The run does not show why:

- levels 2 and 5 lose more than levels 3 and 4;
- the gap for levels 0 and 1 closes at the largest size;
- level 5 falls so far behind in the single-threaded build (copying blocks of the second matrix
  seems to cost little in WebAssembly, while the tile copies, or another part of level 5's loop,
  may cost more there than they do natively);
- the threaded build comes so close at level 3 with threads.

Which of the differences between the builds causes which result is not something this experiment
can separate.
```

- [ ] **Step 8: `# What the measurements cannot say`.** Keep the heading and the bullets `**Four sizes.**` and `**Baseline vectors, no fused multiply-add.**` word for word. Delete the bullet `**One machine, one day, one browser.**` (its cache sentence and "Another CPU ..." moved in Step 2; the CPU, governor, date and browser are in the Results' "What was measured"; the playground is on the Results and Conclusion pages). Delete the bullet `**Explanations are interpretations.**`, except: its sentence `Each statement above about why a difference arises is a reading consistent with the numbers, not a measurement of the cause.` becomes the section's first paragraph, above the two bullets (with a blank line before the list), and its sentence beginning `It did not count memory traffic` moved in Step 5. Delete the bullet `**Noise.**` (the Results define † and the browser-timing caveat).

- [ ] **Step 9: Mechanical checks.** `python3 -I $SCRATCH/prose.py diff $SCRATCH/before/discussion.md docs/paper/discussion.md` must show:
  - about 3843 words (target ≤ 3850, from 4394), sentences over 30 words ≤ 17 (from 23);
  - placeholders removed, each once, exactly: `{{env largest}}`, `{{env counters_n}}`, `{{env firefox}}`, `{{env cpu}}`, `{{env governor}}`, `{{env date}}`, `{{env triad_max}}`, `{{env peak_max}}`, `{{env counters_threads}}`; added: none;
  - headings removed exactly `# The answer does not change`; none added; fenced blocks identical; no suspicious lines.
  `grep -c "^|---" docs/paper/discussion.md` prints 12 (all tables kept).

- [ ] **Step 10: Tests, build, check.** `web/dev/node.sh site npm test` (186 pass), build, check (PASS). `grep -c "{{" web/site/dist/discussion/index.html` prints 0; `grep -c 'class="term"' web/site/dist/discussion/index.html` is at least 10.

- [ ] **Step 11: Facts kept.** Tick each with its location:
  - [ ] the five summary bullets and the level legend, unchanged
  - [ ] one laptop, one day, one browser; cache sizes (L1d and L2 per core, L3 shared); another CPU would give other ratios
  - [ ] all {{env runs}} cases gave the same result for each size, bit for bit, every level, thread count and build
  - [ ] the obvious explanation (idle cores) is not the main cause; level 1 on one thread no faster than level 0; neither figure is noise (repeats, within a few per cent); level 1 table; eight threads = all hardware threads on the physical cores; at the largest size none of it comes close to level 2 on one thread
  - [ ] culprit: memory, measured directly only at two sizes; the one-thread table; level 3 only slightly faster than level 2, most of the gain with level 2, the reuse reading; the gain grows with size, mostly level 0 slowing (table); two cache thresholds between 512 and 1024 (6 MiB / 24 MiB against the L3; column walk 32 KiB / 64 KiB against the L1d; primer link); the miss-count table; the naive walk goes to main memory; its "What this does not show"
  - [ ] level 3 keeps a block of the output in vector registers (link); level 4's copy, faster at every thread count at the two largest sizes (table), much smaller lead at 1024, within a tenth and neither always ahead at the two smaller; the compiler-vectorising "does not show"
  - [ ] counters: one thread, two sizes, method on the Results page; n = 1024: fewer L1 misses, cycles did not follow, same IPC (table), the L2-overlap reading; largest size: fewer misses, far fewer last-level loads, strided reads no longer caught by the L2 (table); cycles fell by about the time fraction, IPC rose; level 4's shorter time with fewer cycles and fewer loads past the L2, as predicted; strongest evidence, with limits; level 5 fewer cycles still at that size, higher IPC, more L1 loads (level 2's kernel), cycles order levels 3 to 5 as times, the 4-to-5 step is waiting not instructions; few TLB misses; "does not show": n = 1024 reading untested, not the whole saving, one thread only, nothing counted for memory traffic, execution units, several threads or the browser, level 1's doubled L1 loads unexplained
  - [ ] twist: level 5 (linked) built for matrices that do not fit, fastest case on four threads at the largest size; measured only on matrices that fit; copies tiles; faster than level 3 at the two largest sizes at every thread count, ahead of level 4 at the largest by little (table); level 4 most of the way; at the smaller sizes close to level 3, never more than a tenth behind; the adjacent-short-rows reading against rows n × 8 bytes apart; level 4 copies only the second matrix and recovers most of the lead; counts agree; its "does not show"; the two speedups against the textbook loop and the IQR
  - [ ] part left open (heading unchanged): levels 2 to 5 stop scaling at the physical cores (table); levels 3 to 5 almost nothing from the second four, level 2 a little more; threads stop when something shared is used up; triad stops at four, the arithmetic test kept gaining (table); rates of one test loop, not the most the cores can do; the test found more arithmetic than the levels use; the spare-arithmetic sentence; the rough 1 GB estimate and the under-a-tenth time; no sign main-memory bandwidth is used up, cannot rule it out; other candidates (L1, L2, feeding machinery) not measured; four-thread throughput falls after 512, one thread much less (table), the shared-cache reading, packing removes the one-thread fall; its "does not show"
  - [ ] browser: slower than native at levels 2 to 5 (table); levels 3 and 4 closest, 128-bit both sides, closest at every size; levels 0 and 1 about native at the largest size, much slower at 1024; the gaps differ between environments (lite: level 4 ahead of 3, level 5 far behind); threaded build within about an eighth, stops after four; builds differ (compilers, shared memory), one-thread comparison; the four "does not show why" items, the WebAssembly copy reading, "cannot separate"
  - [ ] closing: readings, not measurements; "Four sizes"; "Baseline vectors"
  Dropped on purpose: the page-describing meta sentences; the comparison-premise sentences (same-bits rule is in the Abstract and Introduction); level 1 halving and "eight no slower than four" (the table, the Introduction, threaded.md); the n = 1024 hyperthreading reading (untested); repeats of the "cores" and "still open" bullets; the repeated level 3 step; the repeated "built to make the problem possible"; the CPU, governor, date and browser (Results "What was measured"); the triad and test-loop maxima (the table gives each thread count); the counting method (Results); the Noise bullet (Results).

- [ ] **Step 12: Review.** As in Task 1, Step 8, with this checklist; targets: words ≤ 3850, sentences over 30 words ≤ 17, nothing claimed beyond the Replace texts, the reworded bandwidth sentence states no limiter, "test loop" wording intact.

- [ ] **Step 13: Commit.** `git add docs/paper/discussion.md && git commit -m "trim the discussion's repeats and hedges" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 3: Trim the Results

**Files:**
- Modify: `docs/paper/results.md`

**Interfaces:**
- Consumes: the insertions under the Results headings (`site.config.mjs`; do not edit it).
- Produces: `# What was measured` as a bulleted list plus a two-row builds table; `# Noise and limits` folded into it and deleted; the native tables placed after their intro paragraph.

Rule: report, do not interpret, do not signpost. Keep every method fact. GFM has no definition lists, so the "definition list" the editor asked for is a bulleted list with bold leads.

- [ ] **Step 1: Baseline.** `cp docs/paper/results.md $SCRATCH/before/`; stats (expect 1022 words, 5 sentences over 30 words, 37 placeholders). If `web/site/dist` exists from a fresh build, run `python3 -I $SCRATCH/placement.py results` and keep the output (expect FAIL for `native` and `hardware-event-counts`).

- [ ] **Step 2: Opening.** Find: «These are the measurements the case rests on: the same matrix product, timed at every level, natively and in a web browser, on one machine, with hardware event counts for the cache-related suspects. This page reports them, with a question to answer before each group of figures, and nothing else: the [Discussion](crate::discussion) says what they mean. Every figure on it comes from the committed data of the reference run, not from this text.» Replace:

```markdown
Every level was timed natively and in a web browser on one machine, and hardware events were
counted natively. This page reports the figures; the [Discussion](crate::discussion) says what
they mean.
```

Keep the "Short on time?" skip paragraph unchanged.

- [ ] **Step 3: `# What was measured`.** Replace the section's two paragraphs (from `Each case multiplies two square matrices` through `the threaded build used a pool of {{env pool}} threads.`) with exactly the following (every sentence is an existing one, moved; the browser builds become a table; the browser-timing sentences come from `# Noise and limits`):

```markdown
- **Data.** Each case multiplies two square matrices of the project's order-sensitive test data
  (the same generator natively and in the browser), at sizes {{env sizes}}.
- **Timing.** The timer covers the multiplication only: the matrices are built once beforehand
  and the result is hashed afterwards. Each case ran {{env warmup}} untimed warm-up runs and
  then {{env repeats}} timed runs.
- **Statistics.** The tables show the **median** and, as the measure of noise, the
  **interquartile range** (IQR): the spread of the middle half of the runs, as a share of the
  median. Cases whose IQR is above 20% are marked † and are indicative only. Throughput is
  `2n³` floating-point operations divided by the median time.
- **Threads.** Level 0 is single-threaded; the other levels were run with each thread count
  shown. Thread counts above {{env physical_cores}} must share physical cores with other
  threads.
- **Blocks.** Levels 2 to 5 use cache blocks of {{env block}} (k by j) and level 5 uses output
  tiles of {{env tile}} (rows by columns by depth of the shared dimension).
- **Machine.** {{env cpu}}, with {{env physical_cores}} physical cores ({{env cores}} logical),
  running {{env os}} with the CPU governor set to {{env governor}}. The run was made on
  {{env date}} from commit {{env commit}}.
- **Native code.** Compiled with {{env rustc_native}} for {{env native_isa}} (RUSTFLAGS:
  {{env rustflags}}).
- **Browser code.** WebAssembly in {{env firefox}}, with {{env browser_isa}} enabled, in two
  builds:

| build | compiler | threads |
|---|---|---|
| lite | {{env rustc_lite}} | one |
| threaded | {{env rustc_threads}} | a pool of {{env pool}} |

Browser timings come from `performance.now()` on a cross-origin-isolated page. Browsers
deliberately coarsen their clocks, so very short times are less precise, and browser timings
depend on the browser, its clock resolution and its WebAssembly engine: read them as indicative.
```

(The Markdown table renders as a plain `<table>`, which check-dist does not count; it counts only `<table class="results">`.)

- [ ] **Step 4: Signposting and interpretation.**
  - Under `# Native`, delete the paragraph `This section asks how much faster each level is than the textbook loop.` (The Predict box asks it. This also moves the native tables after "The tables give every level ...", where they belong.)
  - In the Predict box under `# Throughput against matrix size, native`, Find: «second on a larger problem; if it falls, something got in the way. Which level's throughput» Replace: «second on a larger problem. Which level's throughput» (keep the `> ` on every line of the box).
  - Under `# Hardware event counts`, Find: «The timings say which levels are faster; these counts say what the hardware was doing differently, and are the nearest thing to direct evidence for the memory-system suspects.» Replace: «These counts show what the hardware did differently at each level.» (Same block, so the counters table stays after it.)
  - Same section, Find: «The operands were built in the same process, so a run that builds them and does nothing else was counted too and subtracted.» Replace: «Each count has an operands-only run subtracted.» Keep every other sentence of that paragraph (perf stat, one process per level, two sizes, one thread, user-space only, same compiler, groups small enough that none was time-shared, median of several processes, one multiplication): the test 'the event counts were taken at two sizes ...' guards them.
  - Under `# The same answer everywhere`, Find: «All {{env runs}} measured cases (each timed {{env repeats}} times), every level and every thread count, natively and in both browser builds, produced the same result for each matrix size, bit for bit.» Replace: «For each size, all {{env runs}} cases (every level and thread count, natively and in both browser builds) produced bit-identical results.» Keep the hashing sentence.
  - Keep `# Run it yourself` unchanged (check-dist requires the Results page to link to the playground).
  - Delete `# Noise and limits` and everything under it (its IQR, † and thread-count facts are in "What was measured"; "one machine" is in the opening; "these compilers" repeats the builds).

- [ ] **Step 5: Mechanical checks.** `python3 -I $SCRATCH/prose.py diff $SCRATCH/before/results.md docs/paper/results.md`: about 868 words (target ≤ 880); sentences over 30 words ≤ 3; placeholders removed exactly `{{env repeats}}` once; added none; headings removed exactly `# Noise and limits`; no suspicious lines.

- [ ] **Step 6: Tests, build, check, placement.** `web/dev/node.sh site npm test` (186 pass), build, check (PASS: it also checks the Results' table and chart counts and the playground link). `python3 -I $SCRATCH/placement.py`: all ten `ok` (the `results native` line now passes; if any other fails, a block count under a Results heading changed: restore it). `grep -c "{{" web/site/dist/results/index.html` prints 0.

- [ ] **Step 7: Facts kept.** Tick each with its location:
  - [ ] every level timed natively and in a browser on one machine; events counted natively; Discussion link; skip line
  - [ ] order-sensitive test data, same generator in both environments, sizes {{env sizes}}
  - [ ] timer covers the multiplication only (built before, hashed after); {{env warmup}} warm-ups, {{env repeats}} timed runs
  - [ ] median; IQR defined; † above 20%, indicative; throughput = 2n³ / median
  - [ ] level 0 single-threaded, the others at each thread count; above {{env physical_cores}} threads share cores
  - [ ] cache blocks {{env block}} (k by j), output tiles {{env tile}}
  - [ ] machine: cpu, physical and logical cores, os, governor, date, commit
  - [ ] native: compiler, ISA, RUSTFLAGS
  - [ ] browser: {{env firefox}}, {{env browser_isa}}, lite and threaded builds with their compilers, pool of {{env pool}}
  - [ ] browser timings: performance.now(), cross-origin isolation, coarse clocks, indicative
  - [ ] the four Predict boxes (throughput box without its interpretation clause) and each section's intro sentence
  - [ ] in the browser: the lite build is the one the step-through diagrams use; the level 3 figures
  - [ ] counts: perf stat, one process per level, 1024 and {{env counters_n}}, {{env counters_threads}} thread, user-space, same compiler, operands-only run subtracted, none time-shared, median of several processes, one multiplication
  - [ ] same answer: {{env runs}} cases bit-identical per size; hashes; the script refuses otherwise
  - [ ] run it yourself: playground link
  Dropped on purpose: "with a question ... and nothing else"; "every figure comes from the committed data" (the Global rule, and the Discussion opening says so); "This section asks ..."; the throughput box's "if it falls, something got in the way" (interpretation); "nearest thing to direct evidence" (interpretation); "Before the Discussion weighs this evidence ..."; "measurements of one machine on one day" (opening); "these compilers"; "(each timed {{env repeats}} times)" in the same-answer sentence (stated under Timing).

- [ ] **Step 8: Review.** As in Task 1, Step 8; targets: words ≤ 880, sentences over 30 words ≤ 3, no interpretation left on the page (no "evidence", "suspect", "got in the way").

- [ ] **Step 9: Commit.** `git add docs/paper/results.md && git commit -m "fold the results method into a list and cut its signposting" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

## Pass 2: the front of the paper and the levels

### Task 4: Trim the Introduction

**Files:**
- Modify: `docs/paper/introduction.md`

**Interfaces:**
- Consumes: Task 1's edit to the "How to read this" clause (this task removes the clause).
- Produces: the same headings minus `# What this is not`.

Rule: keep the case (the hook, the test loop, the obvious suspect, the clue, the line-up) and its headings; say the "same bits" rule once (paragraph 2); cut trivia and the table of contents written as prose. The headings `# A minute or a second`, `# How much of the core was the loop using?` and `# The obvious suspect` stay: the editor's "merge into one running case" is done by trimming the joins, not by removing the headings readers scan by.

- [ ] **Step 1: Baseline.** `cp docs/paper/introduction.md $SCRATCH/before/`; stats (expect about 1084 words, 3 sentences over 30 words, 14 placeholders).

- [ ] **Step 2: Edits.**
  - Find: «Nothing clever happened to the arithmetic. No multiplication was skipped, no sum was reordered, and nobody found a better algorithm: every version here returns the same answer, bit for bit. That is the rule that makes the puzzle fair. If the arithmetic is the same, the difference must lie in *how the work was laid out over the hardware*: which core does which part, in what order the memory is touched, what is kept close to the arithmetic units and, for matrices too big for memory, what is never held all at once. This paper goes looking for it, and matrix multiplication is only the worked example.» Replace:

```markdown
No multiplication was skipped, no sum was reordered, and nobody found a better algorithm: every
version here returns the same answer, bit for bit. So the difference lies in *how the work meets
the hardware*: which core does which part, the order memory is touched, what stays near the
arithmetic, and, for matrices too big for memory, what is never held at once.
```

  - Find: «(It is not the most the core could do: it uses no fused multiply-add and 128-bit vectors only. It is a yardstick, not a limit.)» Replace: «(It uses no fused multiply-add and only 128-bit vectors, so it is a yardstick, not the most the core could do.)» (The editor's "not the core's ceiling" is replaced: the test loop is never a limit or ceiling in prose.)
  - Find: «A version of the loop that changes only the order in which one thread walks through memory, [level 2](crate::cache_friendly), needs {{ms cache_friendly t=1}} on a *single* thread.» Replace: «[Level 2](crate::cache_friendly) changes only the order in which one thread walks memory, and takes {{ms cache_friendly t=1}} on a *single* thread.»
  - Find: «More cores were not the main thing the loop was missing. Whatever it was missing, a single thread could be given.» Replace: «More cores were not the main thing the loop was missing.»
  - Find (in `# Mechanical sympathy`): «The phrase comes from motor racing, where it is credited to the driver Jackie Stewart and means driving with an understanding of how the machine works. The engineer Martin Thompson popularised it in software. A processor is not an abstract machine that executes your loops one step at a time. It has several cores, a hierarchy of memories that differ enormously in speed (small, fast caches between the cores and the main memory), and vector units that do several operations at once. The rest of the paper» Replace: «The phrase comes from motor racing, where it means driving with an understanding of how the machine works. Here the machine is a processor, with its cores, its caches and its vector units. The rest of the paper» (the rest of that paragraph, including "The matrix product is a good place to search ...", stays).
  - Find: «Each level tests one suspect: it changes how the hardware is used in one main way, and targets the bottleneck the previous level ran into. Every level returns exactly the same bits as the one before.» Replace: «Each level changes one thing, aimed at the bottleneck the previous level hit.»
  - In the line-up table, the Level 4 row's middle cell. Find: «the vector kernel reading the second matrix in place, a row apart, so that each step lands on a different cache line and, with a long row, a different page» Replace: «the kernel reads the second matrix a row apart, so each step hits a new cache line and, for long rows, a new page» (the row stays one line).
  - Find: «The [Discussion](crate::discussion) returns to what happened when it was timed anyway.» Replace: «On four threads it is the version that opened this page; the [Discussion](crate::discussion) returns to why.» (Names the fast version the opening times. Covered by 'the opening' and 'the verdict' tests; no placeholder added.)
  - Find: «The [Results](crate::results) are measurements of the six levels, natively and in a web browser, on one machine; the [Discussion](crate::discussion) weighs them and says what they do and do not show; the [Conclusion](crate::conclusion) gives the lesson and the part that stays open. The [playground](crate::playground) runs» Replace: «The [playground](crate::playground) runs» (If Task 1 has not run, the Find says "gives the verdict" instead of "gives the lesson".)
  - Find (the last paragraph of `# How to read this`, the heading `# What this is not`, and the first three sentences under it): «You can also jump straight to a chapter; each stands on its own. The code is real Rust: the diagrams are driven by it and so are the measurements. It is written in plain loops so that each level reads like the loop nest it is. # What this is not This is not a linear algebra library, and it is not about better algorithms. Methods such as Strassen's reduce the number of multiplications; none of the levels here does, and the arithmetic never changes. The code is deliberately short, safe and untuned, so that you can read all of it.» Replace (the paragraph keeps its last two sentences, "If you need a fast matrix product ..." and the source link, after this text):

```markdown
This is not a linear algebra library. Methods such as Strassen's reduce the number of
multiplications; none of the levels here does. The code is real Rust, deliberately short, safe and
untuned, so that you can read all of it; the diagrams are driven by it and so are the
measurements.
```

- [ ] **Step 3: Mechanical checks.** `prose.py diff`: about 856 words (target ≤ 860); sentences over 30 words ≤ 2; placeholders unchanged (removed none, added none); headings removed exactly `# What this is not`; the line-up table still has 6 body rows (`grep -c "^| \[Level" docs/paper/introduction.md` prints 6); no suspicious lines.

- [ ] **Step 4: Tests, build, check.** `web/dev/node.sh site npm test` (186), build, check (PASS); `grep -c "{{" web/site/dist/introduction/index.html` prints 0.

- [ ] **Step 5: Facts kept.** Tick each with its location:
  - [ ] heading "A minute or a second"; {{env madds}} multiply-adds; textbook loop {{ms naive}}; same multiply-adds {{ms streaming t=4}}
  - [ ] nothing skipped, reordered or a better algorithm; the same answer, bit for bit (said once on the page)
  - [ ] the difference lies in how the work meets the hardware: which core, memory order, what stays near the arithmetic, what is never held at once
  - [ ] test loop: {{peak t=1}} on one core, no FMA, 128-bit only, a yardstick; textbook loop {{gflops naive}} = {{frac naive t=1}}; not short of arithmetic, short of something else
  - [ ] obvious suspect: physical cores and hardware threads (primer link); level 1 on all threads {{ms threaded t=8}}; four threads {{ms threaded t=4}}; second four bought almost nothing
  - [ ] the clue: level 2 one thread {{ms cache_friendly t=1}}, faster than the threaded version on every thread; more cores were not the main thing
  - [ ] mechanical sympathy: motor-racing meaning; the paper searches for what the loop ignores and what it costs; the matrix product is a good place (four lines)
  - [ ] the line-up table, six rows
  - [ ] level 5 a different kind of step, built for matrices too large for memory; it is the version that opened the page; Discussion link
  - [ ] how to read: levels in order, each opens with the clue and closes with what it did not cure; primer first; step-through diagrams (levels 1, 2, 3, 5) and figures (2, 3, 4); playground
  - [ ] short on time: this page, level 2 (most of the one-thread gain), the Discussion summary, the Conclusion; about twenty minutes
  - [ ] not a library; Strassen-style methods not used; real Rust, short, safe, untuned; diagrams and measurements driven by it; use a tuned library for real work; source link
  Dropped on purpose: "Nothing clever happened"; "the rule that makes the puzzle fair"; "matrix multiplication is only the worked example" (Mechanical sympathy says why it is a good example); "Whatever it was missing ..."; Jackie Stewart and Martin Thompson; the abstract-machine and hierarchy sentences (the primer); the line-up's repeat of the same-bits rule; the Results/Discussion/Conclusion table of contents; "jump straight to a chapter" (contradicts "read in order"); the plain-loops sentence; "not about better algorithms ... the arithmetic never changes" (paragraph 2).

- [ ] **Step 6: Review.** As in Task 1, Step 8; targets: words ≤ 860, sentences over 30 words ≤ 2, "same bits" stated once on the page (`grep -c "bit for bit\|same bits" docs/paper/introduction.md` prints 1), no "limit", "peak" or "ceiling" about the test loop.

- [ ] **Step 7: Commit.** `git add docs/paper/introduction.md && git commit -m "trim the introduction" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 5: Trim the Primer

**Files:**
- Modify: `docs/paper/primer.md`

**Interfaces:**
- Consumes: the glossary plugin reads the `# Terms used in the chapters` table (do not touch it).
- Produces: a shorter body; the terms table byte-identical.

Rule: keep the toolkit (hierarchy, cache lines, row and column walks, reuse, bandwidth, cores, hardware threads, lanes, the four questions, the terms). Cut the opening's restatement of the Introduction, the pointers that give away level 0's and level 2's findings, and the sentences that repeat the four questions. The glossary is not reordered or shortened (its order is asserted by `remark-glossary.test.mjs`; the editor's "make it alphabetical and drop terms the body defines" conflicts with the binding rules and is not done).

- [ ] **Step 1: Baseline.** `cp docs/paper/primer.md $SCRATCH/before/`; stats (expect 1709 words, 4 sentences over 30 words, 6 placeholders).

- [ ] **Step 2: Edits.**
  - Opening. Find: «The [Introduction](crate::introduction) left a question open: why does a loop that performs the same multiply-adds as its fastest relative use so little of what the core can do? Answering it takes a few ideas about how a processor works. This page introduces them once, with small examples you can check by hand, so that the chapters can use them as instruments without stopping. If you already know» Replace: «This page introduces the few ideas about processors that the chapters use. If you already know» (the rest of the sentence, "... skip to [level 0](crate::naive).", stays).
  - Find: «Walking **down a column**, a **strided** walk in which each step jumps over a whole row, touches eight values and brings in eight cache lines, one per row, and uses one value in each: a quarter of what was fetched.» Replace: «Walking **down a column** is **strided**: each step jumps a whole row. It touches eight values but brings in eight lines and uses one value from each, a quarter of what was fetched.» (Same paragraph: the cache-line figure is spliced after the section's first paragraph, which does not change.)
  - Find: «For a matrix with n rows, a column walk touches n lines, so keeping them needs n lines of 64 bytes: 64 KiB for n = 1024, which is more than the {{env l1d}} L1 data cache of the laptop used in this paper holds.» Replace: «A column walk over n rows touches n lines, 64 KiB at n = 1024. That is more than this laptop's {{env l1d}} L1 data cache.» (Tested by 'the cache facts'.)
  - Delete: «That is the likely reason the textbook loop of level 0 slows down as matrices grow, and it is why level 2 rearranges its loops. The [Discussion](crate::discussion) says how far the measurements support this.» (The editor suggested moving the first sentence to level 0; a level page carries no measured result, and naive.md's cost item 2 already says, hedged, that the loop probably waits for memory. So it is cut, not moved.)
  - Find: «Moving a number from memory costs far more than doing arithmetic with it, so a good implementation ideally loads each number once, or as few times as possible, and uses it many times before it leaves the fast memory.» Replace: «Moving a number costs far more than computing with it, so a good implementation loads each number as few times as possible and uses it many times while it is close.»
  - Delete: «Every level of the Methods is an answer to the question "how can the same arithmetic move fewer bytes, or move them in a way the hardware likes?"» (repeats the four questions).
  - Find: «It also presents {{env cores}} **hardware threads**: each core can keep two threads in flight, and while one waits for memory the other can use the core's idle arithmetic units; the two share those units.» Replace: «It presents {{env cores}} **hardware threads**: each core runs two, which share its arithmetic units, so one can compute while the other waits for memory.»
  - Delete: «(The machine could do wider vectors; a default build does not ask for them, which also keeps the native and browser results comparable.)» (The Introduction's test-loop caveat, the Discussion's "Baseline vectors" bullet and simd.md's vector-width section carry it.)
  - Find: «Each suspect in the case comes down to one of four questions, and the Methods return to them again and again. They are the checklist to carry through each chapter:» Replace: «Four questions recur:»
  - The memory-hierarchy `text` block, the terms table and the closing line stay byte-identical.

- [ ] **Step 3: Mechanical checks.** `prose.py diff`: about 1502 words (target ≤ 1520); sentences over 30 words ≤ 1; placeholders unchanged; headings unchanged; fenced blocks identical; **terms table identical: True**; no suspicious lines.

- [ ] **Step 4: Tests, build, check, placement.** `web/dev/node.sh site npm test` (186: the glossary tests read the table), build, check (PASS: the primer must mark no term), `python3 -I $SCRATCH/placement.py primer` (`ok`).

- [ ] **Step 5: Facts kept.** Tick each with its location:
  - [ ] what the page is; skip line to level 0
  - [ ] arithmetic is cheap, moving data is not; memory hierarchy and its diagram; the shape; smallest first; cache; evict
  - [ ] cache line, typically 64 bytes, eight f64; asking for one brings the line; free if used
  - [ ] row-major storage; the 8 × 8 example with four-value lines (figure after the first paragraph)
  - [ ] a row walk uses everything (two lines); a column walk is strided, eight lines, one value each, a quarter; one in eight with real lines
  - [ ] waste avoidable if lines survive; column walk n lines, 64 KiB at n = 1024, more than {{env l1d}}; evicted and fetched again
  - [ ] 2n³ operations on 3n² numbers, 2n/3 each, about 680 at 1024; each element used n times; load few times, use many
  - [ ] reuse; bytes moved per operation; memory-bound and compute-bound; bandwidth, shared by the cores
  - [ ] cores; {{env cpu}} with {{env physical_cores}} physical cores; {{env cores}} hardware threads, two per core, sharing arithmetic units; a second thread helps a program that waits
  - [ ] registers, vector register, SIMD, lane; 128-bit holds two f64; the Results use 128-bit in both environments ({{env native_isa}}, {{env browser_isa}})
  - [ ] the four questions, unchanged
  - [ ] the terms table, byte-identical; "That is the whole toolkit"
  Dropped on purpose: the Introduction's question; "examples you can check by hand ... instruments"; the level 0 / level 2 / Discussion spoilers; the question that repeats the four questions; the wider-vectors parenthetical; the checklist sentence.

- [ ] **Step 6: Review.** As in Task 1, Step 8; targets: words ≤ 1520, sentences over 30 words ≤ 1, no sentence that states a finding of a later chapter (`grep -in "level 0\|level 2\|Discussion" docs/paper/primer.md` shows only the skip line's and the closing line's links to level 0).

- [ ] **Step 7: Commit.** `git add docs/paper/primer.md && git commit -m "trim the primer's opening and spoilers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 6: Trim levels 0 to 2 (naive, threaded, cache_friendly)

**Files:**
- Modify: `docs/levels/naive.md`, `docs/levels/threaded.md`, `docs/levels/cache_friendly.md`

**Interfaces:**
- Consumes: the story boxes and measurement strips under each chapter's first heading (site config; not edited), the demo and figures under `What it gets right` (threaded) and `Change 2: cache blocking` (cache_friendly, `blocksAfter: 5`).
- Produces: shorter chapters whose openings carry no measured result and no "measurements on the project's website" teaser; "Still three whole matrices in memory" stated only in naive.md.

Rules for the level chapters (both level tasks):
- The opening (second) paragraph carries the inherited clue and what this level changes, and no measured result: the site's story box and measurement strip, right under the first heading, carry the result with its size and numbers. (The editor's rewrites that kept a measured comparison in an opening, cache_friendly #1 and simd #2, are not used: the claims tests check those comparisons at the largest size only, and the rustdoc sentences had no size.)
- Each "bit-identical" section keeps only what its level adds (naive defines the rule; cache_friendly explains reassociation; simd edges and FMA; packed packed values; streaming the tile argument). The plan's edits already do this; do not cut more.
- "Still three whole matrices in memory" stays only in naive.md's cost list.
- A cost bullet and the "Where to go next" section do not say the same thing twice: the cost list names the cost, the next step names the level that fixes it in one or two sentences.
- Every fenced block byte-identical; headings unchanged; the first line's bold lead unchanged.

- [ ] **Step 1: Baseline.** `cp docs/levels/{naive,threaded,cache_friendly}.md $SCRATCH/before/`; stats for each (expect naive 548 words / 2 long, threaded 753 / 2, cache_friendly 1053 / 4).

- [ ] **Step 2: naive.md.**
  - Find: «The textbook algorithm: one thread, three nested loops, no tricks.» Replace: «The textbook algorithm: one thread and three nested loops.» (The rest of the first paragraph, including the primer line, stays.)
  - Find: «This is where the case starts. It is the baseline that every other level is measured against, and it is correct and easy to read. It is also far from what the processor can do, and nothing in the code says why. The chapters that follow look for the reason one suspect at a time.» Replace: «This is where the case starts. It is far from what the processor can do, and nothing in the code says why.» (Keeps the tested wording of 'the hook'; the editor's "far slower than the processor allows" implies a limit and is not used.)
  - Find: «- **It is obviously correct.** There is nothing here to get wrong, which is why it is the reference for the other levels.» Replace: «- **It is obviously correct.** It is the reference for the other levels.»
  - Find: «reduces that count**. Everything that follows is about doing the same work faster, or on bigger data. The problems» Replace: «reduces that count**. The problems»
  - Item 2. Find: «`Matrix` stores rows contiguously, so consecutive reads are `p` elements apart: almost every access lands on a different cache line, and a line fetched for `B[k][j]` is mostly wasted when the loop moves on.» Replace: «Rows are contiguous, so consecutive reads are `p` elements apart. Nearly every read fetches a new cache line and uses one value from it.» (keep the item's following sentences; indent continuation lines by three spaces as now).
  - Item 3. Find: «This is a constant-factor cost (the optimiser can remove some of it, not reliably all), and later levels sidestep it by iterating over slices.» Replace: «The optimiser removes some of these checks, not reliably all. Later levels avoid them by iterating over slices.»

- [ ] **Step 3: threaded.md.**
  - Find: «The same triple loop, spread across threads. One idea, a few lines of new code.» Replace: «The same triple loop, spread across threads.»
  - Find: «that by giving every core a share of the same loop. The chapter shows how, and the measurements on the project's website show how far it gets.» Replace: «that by giving every core a share of the same loop.»
  - Under `# What it gets right`, delete the bullet «- **Near-linear scaling is possible**, up to the number of cores, when nothing the threads share is used up.» (the cost bullet says it).
  - Replace the first cost bullet (from «- **Each thread is as slow as level 0, and the threads share the hardware.**» through «and the threads go further.») with:

```markdown
- **The threads share the hardware.** Every thread still walks a *column* of `B` for each
  output element (the level-0 access pattern), and all of them share the same memory system and
  the same cores. Threads help until they exhaust a shared resource. Which resource that is
  depends on the machine and on each thread's loop. If this loop mostly waits for memory, other
  threads can use those idle cycles, so gains may continue for a while.
```

  (The clue "each thread's loop is exactly as slow as level 0's" is stated once, in "Where to go next", which stays unchanged: the test 'level 1 thread scaling' names threaded.md for it.)
  - Find: «For this problem every row costs the same, so equal blocks are fine, but if one thread were slowed by something else the others would idle waiting for it.» Replace: «Every row costs the same, so equal blocks suit this problem. If one thread is slowed, though, the others wait.» (keep "Level 5 uses a work queue instead.": the only use of the glossary term "work queue").
  - Delete the bullet `- **Still three whole matrices in memory.**`

- [ ] **Step 4: cache_friendly.md.**
  - Find: «Level 1 left a clue: adding threads did not fix the loop, so the number of cores doing the arithmetic was not what held it back. This level goes after the best remaining suspect, the way the loop walks memory, and the measurements on the project's website show that these two changes to the loop, on a single thread, beat level 1 on every thread.» Replace: «Level 1's clue: more cores did not fix the loop, so the shortage was not cores. The next suspect is the order in which the loop walks memory.»
  - Find: «Only the kernel, the loop nest each thread runs. The row-block partitioning and the scoped threads are the same driver as level 1 ([`threaded`](crate::threaded)); the kernel is what changes. Two changes to the kernel:» Replace: «Only the kernel, the loop nest each thread runs, changes; the row-block partitioning and the scoped threads are level 1's ([`threaded`](crate::threaded)). Two changes to the kernel:»
  - Under `# Change 1`, Find: «The earlier levels compute each `C[i][j]` as a dot product of a row of `A` with a *column* of `B`. In row-major storage a column is strided, so nearly every read of `B` touches a different cache line, and most of each line that is fetched goes unused.» Replace: «The earlier levels compute each `C[i][j]` as a dot product of a row of `A` with a *column* of `B`, a strided walk.» (naive.md's item 2 explains the cost.)
  - Under `# Change 2`, Find: «Row `k` of `B` is used for one `i`, and then, by the time the loop returns to it for the next `i`, it has been evicted.» Replace: «Row `k` of `B` is evicted before the loop needs it again for the next `i`.» (Same paragraph: `blocksAfter: 5` still lands the reuse figure after "A block of `B` is ...".)
  - First cost bullet, Find: «once per `(i, k)` pair, even though the data is now in the cache. Loads and stores can limit the speed as much as the arithmetic does. Level 3 removes most of that traffic.» Replace: «once per `(i, k)` pair, even though the data is now in the cache. Loads and stores can limit the speed as much as the arithmetic does.»
  - Delete the cost bullets `**Faster threads saturate sooner.**` (threaded.md's cost bullet), `**Still three whole matrices in memory.**` (naive.md) and `**Not a BLAS.**` (it only previews levels 3 and 4). Keep «**Every thread streams all of `B`.**».
  - Replace both paragraphs of `# Where to go next` (from «Most of the gain is in» through «[`streaming`](crate::streaming) removes it.») with: «[`simd`](crate::simd) removes most of the first cost above: it keeps a block of `C` in vector registers for the whole inner loop.» ("Most of the gain is in" is a measured result; the 240 GB example opens streaming.md.)

- [ ] **Step 5: Mechanical checks.** For each page, `prose.py diff`: fenced blocks identical True; headings unchanged; placeholders none before and after; no suspicious lines. Targets: naive about 474 words (≤ 490), long sentences ≤ 1; threaded about 642 (≤ 660), ≤ 2; cache_friendly about 829 (≤ 850), ≤ 3. Also `head -1 docs/levels/*.md` still shows each bold lead, and `grep -n "project's website" docs/levels/{threaded,cache_friendly}.md` prints nothing, `grep -ic "three whole matrices" docs/levels/naive.md docs/levels/threaded.md docs/levels/cache_friendly.md` prints 1, 0, 0.

- [ ] **Step 6: Doctests, tests, build, check, placement.** `cargo test --doc` (30 passed); `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps` (no warnings); `web/dev/node.sh site npm test` (186: includes the story-box, strip and glossary dead-term tests); build; check (PASS: one story box per level, demos present); `python3 -I $SCRATCH/placement.py levels/cache_friendly` (`ok`).

- [ ] **Step 7: Story boxes.** Read each box in `levelStory` (`web/site/site.config.mjs`) for these three levels against the new chapter and confirm it is still accurate (expected: yes for all three; naive's "correct and easy to read" and "no tricks" are still true of the code, threaded's "almost every read lands on a different cache line" matches naive's new item 2). Do not edit a box; if one is wrong, stop and report.

- [ ] **Step 8: Facts kept.** Tick each with its location:
  - naive: [ ] summary (level 0, one thread, three loops; everything modifies this function; tested against it; primer line) [ ] the case starts; far from what the processor can do; the code does not say why [ ] the idea, the formula, the loops, `matmul` with `a[(i, k)]`, the doctest [ ] obviously correct, the reference [ ] defines the summation order; every level returns exactly the same bits [ ] accumulator in a register [ ] 2·m·n·p operations, no later level reduces them; the problems are how it touches memory and processors [ ] one core (level 1) [ ] column walk: `p` apart, a new line per read, one value used, probably waits for memory (level 2) [ ] bounds checks: optimiser removes some, later levels use slices [ ] three whole matrices, 3·n²·8 bytes (level 5) [ ] next: the obvious suspect, threaded link
  - threaded: [ ] summary [ ] obvious suspect: idle cores; this level tests it by sharing the loop [ ] what changed: independent rows, blocks, the diagram, untouched inner loops, the pseudocode, the doctest [ ] implementation notes unchanged [ ] results unchanged bit for bit; no locks or atomics [ ] threads share memory system and cores; help until a shared resource is exhausted; which one depends on machine and loop; gains may continue if the loop waits for memory [ ] fixed equal blocks; every row costs the same; a slowed thread makes the others wait; level 5's work queue [ ] capped at the row count [ ] next: more threads helped less than their number; each thread as slow as level 0; cache_friendly link
  - cache_friendly: [ ] summary [ ] level 1's clue; next suspect: memory order [ ] only the kernel changes; partitioning and threads are level 1's; two changes [ ] change 1: dot product with a strided column; i-k-j; pseudocode; axpy and its three properties; `C` accumulated, starts at zero [ ] change 2: row `k` evicted before the next `i`; reloaded once per row; blocking; pseudocode; 16 KiB block in a 32 KiB L1; defaults, not tuned; doctest [ ] bit-identical section unchanged [ ] the comparison table unchanged [ ] cost: `C` moves every step, loads and stores can limit speed [ ] cost: every thread streams all of `B` [ ] next: simd removes most of that cost with registers
  Dropped on purpose: "no tricks", "easy to read" restatements; signposts; "Near-linear scaling"; "That is the main reason level 2 exists"; the duplicate clue in threaded's cost list; the website teasers; the measured "beat level 1 on every thread" (strip, story box, Discussion); the repeated column-walk explanation; "Faster threads saturate sooner"; "Not a BLAS"; "Most of the gain is in"; the 240 GB paragraph (streaming.md "The problem"); "Still three whole matrices" outside naive.md.

- [ ] **Step 9: Review.** As in Task 1, Step 8, for the three pages; also: no measured result in any opening, fenced blocks identical, the bold leads unchanged, each next-step section one or two sentences and not a copy of a cost bullet.

- [ ] **Step 10: Commit.** `git add docs/levels/naive.md docs/levels/threaded.md docs/levels/cache_friendly.md && git commit -m "trim the level 0 to 2 chapters" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 7: Trim levels 3 to 5 (simd, packed, streaming)

**Files:**
- Modify: `docs/levels/simd.md`, `docs/levels/packed.md`, `docs/levels/streaming.md`

**Interfaces:**
- Consumes: the story boxes and strips under each first heading; the demo and register figure under simd `The micro-kernel` (`blocksAfter: 5`); the video and pack figure under packed `What changed from level 3` (`blocksAfter: 6`); the video under streaming `The idea` and the demo under `The algorithm`.
- Produces: shorter chapters; packed.md with no measured result; no website teasers.

The rules of Task 6 (no measured result in openings, bit-identical sections keep only what the level adds, three-matrices line only in naive.md, cost list against next step, fenced blocks byte-identical, headings and bold leads unchanged) apply. A level page cannot link the primer (rustdoc has no such page): the editor's "replace the SIMD background with a link to the primer" becomes a shorter background instead.

- [ ] **Step 1: Baseline.** `cp docs/levels/{simd,packed,streaming}.md $SCRATCH/before/`; stats (expect simd 1651 words / 8 long, packed 1060 / 5, streaming 1484 / 4).

- [ ] **Step 2: simd.md.**
  - Find: «in the processor's vector registers for the whole inner loop. On one thread the gain is much smaller than level 2's, which is itself part of the answer: most of the gain over the textbook loop had already arrived with level 2.» Replace: «in the processor's vector registers for the whole inner loop.» (Measured, and stated without its size; the Discussion carries it.)
  - Find: «How much that costs depends on how well the processor overlaps the traffic with the arithmetic, so the gain from the fix varies from one machine to another.» Replace: «The gain depends on how well the processor overlaps memory traffic with arithmetic.» (Keep the sentence before it with "even when every access hits the cache": the only use of "hit".)
  - Under `# A little SIMD background`, Find: «A **SIMD** (single instruction, multiple data) instruction applies one operation to a whole **vector** of numbers held in a wide register. Each slot of the vector is a **lane**. How many» Replace: «A **SIMD** (single instruction, multiple data) instruction applies one operation to a whole **vector** of numbers in a wide register, one per **lane**. How many» (the rest of that sentence and the lanes table stay).
  - Find: «One vector multiply-add therefore does 2, 4, or 8 scalar multiply-adds in the time of one. The condition for using it is that those scalar operations are **independent**: lane `l` must not need lane `l - 1`'s result.» Replace: «One vector multiply-add therefore does 2, 4, or 8 scalar multiply-adds in the time of one, provided they are **independent**: lane `l` must not need lane `l - 1`'s result.»
  - Under `# The micro-kernel`, Find: «Per `k` this does one `B` load and `MR` broadcasts to perform `MR × NR` multiply-adds, and `C` is loaded and stored once per *`depth`* multiply-adds instead of once per multiply-add.» Replace: «Each `k` costs one `B` load and `MR` broadcasts for `MR × NR` multiply-adds. `C` moves once per *`depth`* steps, not on every step.» (Same paragraph, which keeps "This is the central idea ...": the register figure is spliced after it.)
  - Under `# The result is still bit-identical`, Find: «Rust also does not fuse a multiply and an add into a single FMA instruction on its own, even when the target has one, so each product is rounded before it is added, exactly as in the naive loop. A fused multiply-add rounds once instead of twice. It is faster and slightly more accurate, but it would change the bits, so this crate does not use it (`f64::mul_add` would be the way).» Replace: «Rust never fuses a multiply and an add into an FMA on its own, so each product is rounded before the add, as in the naive loop. A fused multiply-add rounds once instead of twice: faster and slightly more accurate, but it would change the bits, so this crate does not use it (`f64::mul_add` would be the way).» (Keeps "FMA", the term's only use.)
  - Delete the cost bullets `**Depends on the optimiser.**` (the implementation notes say it, with the command to check), `**Untuned constants.**` (level 2 says the sizes are defaults) and `**Still three whole matrices in memory.**`
  - `**No packing.**` bullet, Find: «Each micro-kernel call reads `NR` consecutive elements from each of `depth` rows of `B`, a row apart. Copying `B` blocks into a contiguous, micro-kernel-shaped buffer ("packing") makes those reads purely sequential. [`packed`](crate::packed) does exactly that.» Replace: «Each micro-kernel call reads `NR` consecutive elements from each of `depth` rows of `B`, a row apart.»
  - `# Where to go next`, Find: «One cost is still hidden. The kernel reads `B` where it lies in memory, a whole row apart at every step, and that spreads each small block over many cache lines. [`packed`](crate::packed) keeps this micro-kernel» Replace: «[`packed`](crate::packed) removes the last cost above. It keeps this micro-kernel» (the rest of that sentence stays).

- [ ] **Step 3: packed.md.**
  - First paragraph (rustdoc summary). Find: «Same threads, same partitioning, same micro-kernel, same results as level 3, but the micro-kernel no longer reads `B` where it lies in memory. Each cache block of `B` is first **packed**: copied once into a small contiguous buffer, laid out in the order the micro-kernel reads it.» Replace: «Same as level 3, but each cache block of `B` is first **packed**: copied into a contiguous buffer in the order the micro-kernel reads it.» (The bold lead `**Level 4, of levels 0 to 5.**` stays in front.)
  - Find: «This level pays to copy each block once, which looks like a pure loss, and the measurements on the project's website ask whether the copy earns its cost back.» Replace: «This level pays to copy each block once.»
  - Under `# What changed from level 3` (keep all five blocks: two paragraphs, the diagram, two paragraphs, so the pack figure stays after "... a row length of `NR`."), Find: «Rows of `B` are `n` elements apart, so a strip of `B` that the kernel reads in order is spread over memory at a stride of `8·n` bytes: one cache line (or less) from each of `depth` different places.» Replace: «Rows of `B` are `8·n` bytes apart, so each strip the kernel reads comes from `depth` scattered cache lines.»
  - Under `# Why it helps, and why it might not` (the reasons and the hedge, stated once), Find: «Three costs of a strided read go away. These are the usual reasons given for packing; how much of each a given machine shows is for a measurement to say.» Replace: «Three costs of a strided read go away; how much of each a given machine shows is for a measurement to say.»
  - Find: «It pays when each packed block is then used by many groups of rows, and level 4's blocks are reused by every `MR` rows of the thread's output block.» Replace: «Packing pays when many row groups reuse a block. Here every `MR`-row group in the thread's output block reuses it.»
  - Find: «Whether packing wins on a given machine is a measurement, not a fact about the method. A processor» Replace: «A processor» (keep "... a good hardware prefetcher may hide most of the strided-read cost already": the only use of "prefetcher"; keep the "Pages" bullet's "memory pages").
  - `# Where to go next`, Find: «At the two largest sizes the copy did earn its cost back, and the remaining difficulty is no longer mainly speed: every level so far assumes `A`, `B`, and `C` all fit in memory.» Replace: «One assumption remains: every level so far assumes `A`, `B`, and `C` all fit in memory.» (Binding rule: the measured result leaves the docs; the level 4 strip and the Discussion state it with its scope.)

- [ ] **Step 4: streaming.md.**
  - Find: «It is the only level that is not about speed on data that already fits in RAM; it was built to make the problem possible, not to win a race. What happened when it was timed against the others anyway is the twist in the story, told in the Discussion on the project's website.» Replace: «It is the only level built for data that does not fit in RAM.» (The editor's "make the summary and the story box one paragraph" is not possible: the first paragraph is the rustdoc summary and the box is site config. Trimming the opening is the fix.)
  - Find: «The strips are themselves too big to hold, so split the shared dimension `n` into slices of depth `D` and *stream* them through three small buffers, adding each partial product into a running sum.» Replace: «The strips are themselves too big to hold. So split the shared dimension `n` into slices of depth `D`, *stream* them through three small buffers, and add each partial product to a running sum.»
  - Delete the paragraph after the table in `# What changed from level 2`: «The inner loop is deliberately not new: level 2's `axpy`, its `i-k-j` loop order, and its cache-block constants are reused unchanged. Level 5 adds a layer *around* the level-2 kernel, not a replacement for it.» (The table's "Inner kernel" row and "`accumulate_tile` is the level-2 kernel" say it.)
  - Find: «By the argument in the implementation notes above, every `C[i][j]` receives» Replace: «So every `C[i][j]` receives»
  - First cost bullet, Find: «In-memory matrices are copied into the tile buffers before being used, work that the other levels do not do. How that copying compares with [`simd`](crate::simd) depends on the machine: the small, contiguous buffers may suit the caches better than rows of the full matrices, which can offset the copy. That is not the purpose of this level, so measure rather than count on it. If everything fits in RAM,» Replace: «In-memory operands are copied into tile buffers, which other levels skip. On some machines the small, contiguous buffers may suit the cache well enough to offset the copy. That is not this level's purpose: if everything fits in RAM,» (the rest of the bullet, the links to cache_friendly and simd and "Level 5 earns its keep ...", stays. The editor's rewrite dropped "may"; it stays, because the test that names streaming.md checks two sizes on one machine.)
  - Delete the cost bullet `**More machinery.**`
  - Find: «That is the last level. What the six together do and do not explain is in the Discussion on the project's website, and one question, what stops the threads, is still open there.» Replace: «That is the last level.»

- [ ] **Step 5: Mechanical checks.** For each page, `prose.py diff`: fenced blocks identical True; headings unchanged; no placeholders; no suspicious lines. Targets: simd about 1484 words (≤ 1500), long sentences ≤ 6; packed about 946 (≤ 960), ≤ 4; streaming about 1323 (≤ 1340), ≤ 2. `grep -rn "project's website" docs/levels/` prints only naive.md's primer line; `grep -n "earn its cost\|largest sizes" docs/levels/packed.md` prints nothing; `grep -ic "three whole matrices" docs/levels/*.md` prints 1 only for naive.md (0 for the others).

- [ ] **Step 6: Doctests, tests, build, check, placement.** `cargo test --doc` (30 passed); `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps` (no warnings); `web/dev/node.sh site npm test` (186); build; check (PASS); `python3 -I $SCRATCH/placement.py levels/simd levels/packed` (both `ok`).

- [ ] **Step 7: Story boxes.** Check the simd, packed and streaming boxes against the new chapters (expected: all accurate; packed's "ask whether the copy earns its cost back" is still the level's question, and its strip answers it). Do not edit a box; if one is wrong, stop and report.

- [ ] **Step 8: Facts kept.** Tick each with its location:
  - simd: [ ] summary [ ] level 2 put data close; output block still travels; this level keeps it in registers [ ] what changed: innermost step, pseudocode, the compiler can vectorise; two loads and a store per multiply-add; load/store units limit even when every access hits the cache; the gain depends on overlap; the fix [ ] SIMD, vector, lane; the lanes table; 2, 4 or 8 per instruction if independent [ ] micro-kernel: tile, diagram, pseudocode; one `B` load and `MR` broadcasts per `k`; `C` once per `depth`; the central idea; MR and NR, eight registers, `micro_tile_shape` [ ] the two implementation-notes blocks and "Which vector width" unchanged [ ] bit-identical: same order, accumulator from `C`, edges fall back to axpy; Rust never fuses into FMA; FMA rounds once, would change the bits, `f64::mul_add`; tests stress the edges [ ] example and table unchanged [ ] costs: compile-time width; no packing (reads a row apart) [ ] next: packed keeps the micro-kernel, reads a contiguous copy
  - packed: [ ] summary: as level 3, each block packed in micro-kernel order [ ] level 3's cost in plain sight; this level pays to copy each block once [ ] what changed: level 3's kernel reads a row at a time; rows `8·n` bytes apart, `depth` scattered lines; nothing else changes; diagram; strips per cache block; micro-kernel unchanged with row length `NR` [ ] why: three costs; per-machine size is for a measurement; cache lines; pages and the TLB; cache sets [ ] extra work; pays when row groups reuse a block; every `MR`-row group reuses it; short tiles skip the copy; associative caches and a prefetcher may hide the cost [ ] bit-identical unchanged [ ] example and table unchanged [ ] four cost bullets unchanged [ ] next: one assumption remains (all three in memory); streaming removes it with level 2's axpy kernel
  - streaming: [ ] summary unchanged [ ] earlier levels asked about speed; this one asks what if the matrices do not fit; the only level built for that [ ] the problem (80 GB, 240 GB) unchanged [ ] the idea: tiles depend on strips; the diagram; one tile at a time; strips too big; depth slices through three buffers into a running sum; online algorithm [ ] the comparison table unchanged [ ] the algorithm; accumulate_tile is the level-2 kernel; data flow; memory formula; rereading; example; edge cases; correctness notes [ ] every `C[i][j]` receives every product once, in increasing `k`, stored once: same bits as naive [ ] costs: copies into tile buffers; may offset on some machines; not its purpose; levels 2 and 3 simpler if it fits; earns its keep when it does not fit or results are consumed; rereading; I/O can fail [ ] last level
  Dropped on purpose: the measured one-thread comparison in simd's opening; the "varies from machine to machine" clause; "Depends on the optimiser", "Untuned constants", the packing explanation in simd's cost list, "One cost is still hidden ..."; packed's "same threads, same partitioning ..." list in the summary, "looks like a pure loss", the second hedge, the measured "did earn its cost back"; streaming's "not to win a race" and the twist teaser, "deliberately not new ...", "measure rather than count on it", "More machinery", the Discussion pointer.

- [ ] **Step 9: Review.** As in Task 6, Step 9, for the three pages; also: packed.md states no measured result; every single-use glossary term listed in the Global Constraints is still on its page (`grep -c "prefetcher" docs/levels/packed.md`, `grep -c "memory pages" docs/levels/packed.md`, `grep -c "FMA" docs/levels/simd.md`, `grep -c "broadcast" docs/levels/simd.md`, `grep -c "hits the cache" docs/levels/simd.md` each at least 1).

- [ ] **Step 10: Commit.** `git add docs/levels/simd.md docs/levels/packed.md docs/levels/streaming.md && git commit -m "trim the level 3 to 5 chapters" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 8: Verify everything and read it through

**Files:** none, unless a check fails (then fix it in the page concerned, within the rules above, and commit).

- [ ] **Step 1: Full verification.** `cargo test` (all, including the 30 doctests); `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps`; `web/dev/node.sh site npm test` (186); build; check (PASS); `python3 -I $SCRATCH/placement.py` (all ten `ok`); `grep -c "{{" web/site/dist/{index,introduction,primer,results,discussion,conclusion}/index.html` prints 0 for each; `grep -c 'id="the-part-left-open-what-stops-the-threads"' web/site/dist/discussion/index.html` prints 1 and the Conclusion links to it.

- [ ] **Step 2: Placeholder accounting across the whole pass.** `BASE=$(git merge-base trunk HEAD)`; for each of the eleven edited pages, `git show $BASE:<path> > $SCRATCH/base.md` and `python3 -I $SCRATCH/prose.py diff $SCRATCH/base.md <path>`. Placeholders added: none on any page. Removed: exactly the lists of Tasks 1, 2 and 3 (Conclusion all ten, Discussion the nine, Results `{{env repeats}}` once), nothing elsewhere.

- [ ] **Step 3: Measures.** Report, per page, words and sentences over 30 words before (at `$BASE`) and after, against the targets: Conclusion ≤ 600 (from 1214), Discussion ≤ 3850 (4394), Results ≤ 880 (1022), Introduction ≤ 860 (1084), Primer ≤ 1520 (1709), naive ≤ 490 (548), threaded ≤ 660 (753), cache_friendly ≤ 850 (1053), simd ≤ 1500 (1651), packed ≤ 960 (1060), streaming ≤ 1340 (1484). Long sentences must not rise on any page.

- [ ] **Step 4: Cross-page repeats** (the editors' list). Run and report:
  - the "same bits" rule, counted on joined lines: `for f in docs/paper/*.md docs/levels/*.md; do echo "$f: $(tr '\n' ' ' < $f | grep -o 'same bits\|bit for bit\|bit-for-bit\|bit-identical' | wc -l)"; done`. Expected: abstract 2, introduction 1, discussion 1 (opening), results 1 ("The same answer everywhere"), conclusion 0, primer 0; naive 1, threaded 1, cache_friendly 1, simd 1, packed 2, streaming 1 (each level's bit-identical section or bullet: naive defines the rule, the others state what their level adds). Anything more is a repeat to cut.
  - `grep -in "three whole matrices" docs/levels/*.md`: naive.md only.
  - `grep -n "measurements on the project's website\|project's website" docs/levels/*.md`: only naive.md's primer line.
  - cost lists against next steps: for each level, put the "What it costs" bullets beside "Where to go next" and confirm the next step names the fixing level in one or two sentences without repeating a bullet's explanation.
  - the Conclusion against the Abstract, Introduction and Discussion: no paragraph of the Conclusion restates another page beyond the two sentences of the open question.

- [ ] **Step 5: Tested claims.** For each row of the **Tested claims** table, find the sentence (`grep -n` a distinctive phrase) and confirm it exists and says no more than the test (same size, thread count, environment and levels). List the test titles that now name a page which no longer states the claim (expected: "Conclusion" in several titles, "packed.md", "introduction.md" in the level 5 against level 3 title); they are labels, left unchanged; report them for a later test-title cleanup.

- [ ] **Step 6: Read it as a first-time reader**, in reading order (Abstract, Introduction, Primer, levels 0 to 5, Results, Discussion, Conclusion) on the built site, and report: whether each page opens with its point; whether any page now refers to something that was cut (a dangling "this", "above" or "below", a reference to a deleted section such as "the verdict", "Noise and limits" or "What this is not"); whether the level openings, story boxes and strips read as one sequence without repeating each other; anything that reads as an editing slip (doubled words, orphaned connectives, a list joined into a paragraph).

- [ ] **Step 7: Report** to the user: what changed per page, the before/after table from Step 3, the repeats check, the tested-claims check, and any fix made in this task (with its commit). If Step 6 needed fixes, commit them with `git commit -m "fix slips from the prose trim" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`; otherwise there is nothing to commit.

---

## Where the editors' suggestions were overridden

For the record (each implementer follows the task text, which already applies these):

| suggestion (report) | what governs | done instead |
|---|---|---|
| Conclusion: Streaming-bullet rewrite and other verdict rewrites (back.md) | the user: "Shrink the conclusion"; the editor's own structural fix deletes "The verdict" | the verdict is deleted, so the rewrites are moot |
| Results: "definition list" (back.md) | GFM has no definition lists | bulleted list with bold leads |
| Discussion #4: "Level 5 needs fewer cycles still" (back.md) | claims scope: the test is at the largest size | "At that size level 5 needs fewer cycles still ..." |
| Discussion #3: "that takes under a tenth" (back.md) | say no more than the test: it is an estimate | "that would take" |
| Discussion: delete the closing section except two bullets (back.md) | facts kept; the glossary dead-term test ("L3") | cache sizes and "another CPU" move to the opening; "readings, not measurements" and "did not count ..." are kept |
| Introduction: "not the core's ceiling" (front.md) | the test loop is never "peak" or "limit" | "not the most the core could do" |
| Introduction: merge the first three sections (front.md) | readability; headings are not linked, so either is allowed | headings kept, joins trimmed |
| Primer: make the glossary alphabetical, drop rows the body defines (front.md) | do not delete glossary rows; reorder only if tests pass (the test asserts the order) | table untouched |
| Primer: move "the likely reason level 0 slows down" to level 0 (front.md) | level pages carry no measured results | cut; naive.md item 2 already has the hedged version |
| naive: "far slower than the processor allows" (levels.md) | 'the hook' test wording; no limit language | "far from what the processor can do" kept |
| cache_friendly #1 and simd #2 keep measured comparisons in rustdoc openings (levels.md) | level pages carry no measured results; the sentences had no size scope | cut from the openings (strips, story boxes and Discussion state them with scope) |
| simd: replace the SIMD background with a primer link (levels.md) | rustdoc has no primer page (`crate::primer` would be a broken intra-doc link) | background shortened in place |
| streaming #1: "the buffers suit the cache well enough to offset the copy" (levels.md) | say no more than the test | "may suit" kept |
| naive: story box to one sentence; simd "What changed" into the box; cache_friendly box carries the clue; streaming summary and box as one paragraph (levels.md) | story boxes are generated config, checked by story.test.mjs; the first paragraph is the rustdoc summary | boxes untouched; chapter openings trimmed instead |
| packed: cut the first paragraph of "What changed from level 3"; similar paragraph cuts under simd "The micro-kernel" and cache_friendly "Change 2" (levels.md) | `blocksAfter` block counts | paragraphs rewritten in place, block counts kept |
