# Glossary Tooltips and Story Boxes

Status: design approved in conversation, 2026-11-08. Builds on the paper narrative design
(`2026-11-08-paper-narrative-design.md`). Site machinery only: no Rust, no `docs/levels` edits.

## Problem

The chapters use terms (cache line, evict, lane, LLC, TLB and more) that the primer defines
in one table (`docs/paper/primer.md`, "Terms used in the chapters", lines 89 to 117). A reader
who meets "evict" on the Discussion page must go back to the primer. Several terms the
chapters use are not in the table at all (L1/L2/L3, FMA, micro-kernel, packing, broadcast,
page, prefetch, speedup). Separately, each level chapter opens cold: the case-file story
(each level inherits clues and takes on one question) is told in the Introduction but not at
the point where the reader starts a level.

## Goal

1. Every defined term shows its definition in place, without leaving the page.
2. Each level chapter opens with a short, always-visible "story box" saying what the reader
   already has and what this level asks.

## Design

### Glossary

- **Plugin.** New `web/site/src/plugins/remark-glossary.mjs`, registered in
  `astro.config.mjs` in `remarkPlugins` after `remarkRustdoc`, so placeholders are resolved
  and `crate::` links are already rewritten. It parses the primer's `# Terms used in the
  chapters` GFM table (read from `docs/paper/primer.md` at plugin setup; a missing table
  fails the build).
- **Terms.** Rows are `Term | Meaning`. Comma-joined cells ("block, tile", "hit, miss",
  "register, vector register", "stride, strided", "memory-bound, compute-bound") split into
  separate terms sharing the row's meaning. A parenthesised form, "last-level cache (LLC)",
  yields the long form and the abbreviation. Meaning text is taken as plain text (backticks
  dropped).
- **Pages.** Applied to chapters whose id starts `levels/` or `paper/`, except `paper/primer`
  (it defines the terms; marking them there is noise).
- **Matching.** Whole words, case-insensitive, longest term first, in `text` nodes only. Each
  term is marked once per page, at its first plain-prose use. Skipped: `inlineCode`, `code`,
  headings, `link`/`linkReference` content, `tableCell` content (the table on the primer and
  every results table), and raw `html` nodes, which covers every insertion from
  `site.config.mjs`. Once a term is marked, later uses are left alone. Marking a term does
  not mark the same words inside another longer term already wrapped.
- **Markup.** The matched text is replaced by an inline `html` node:
  `<span class="term" tabindex="0" aria-describedby="g-N"><span>cache line</span><span
  class="tip" role="tooltip" id="g-N">definition</span></span>`. `N` is a per-page counter,
  so ids are unique. The definition is HTML-escaped (`& < > "`). No JavaScript, so chapters
  without a demo stay script-free (`check-dist.mjs`: "has no demo but loads a script").
- **CSS** (`web/site/src/styles/site.css`). `.term` has a dotted underline and
  `position: relative`; `.tip` is hidden and appears on `.term:hover` and `.term:focus`,
  positioned below the term (`left: 0`, `width: max-content`) with
  `max-width: min(22rem, calc(100vw - 2rem))` and `overflow-wrap: anywhere`, so it cannot
  overflow a phone-width viewport.
  Colours use the existing custom properties, so light and dark both work. The default
  `:focus-visible` outline is kept on `.term`.
- **Primer rows added** (one plain sentence each, no numbers, no benchmark claims):
  L1/L2/L3 cache, FMA (fused multiply-add), micro-kernel, packing, broadcast, page (memory
  page), prefetch, speedup. These are the only edits to `primer.md`; the file is also a
  rustdoc-free paper page, so no doctest is touched.

### Story boxes

- **Data.** `levelStory` in `site.config.mjs`, exported next to `levelFindings`: a map from
  the six `levels/*` ids to `{ label, so_far, this_level }` (`label` is "The case:" for
  `levels/naive` and "So far:" for the rest). Text is plain, condensed from sentences already
  on the level pages (their opening paragraphs and "What changed" sections), with no numbers
  and no new claims.
- **Placeholders.** Not allowed. Story text goes through no `substitute`; a `{{` in it fails
  the test below.
- **Markup.** `<aside class="story"><p><strong>So far:</strong> ...</p><p><strong>This
  level:</strong> ...</p></aside>`, always visible, not collapsed. Styled like `.findings` in
  `site.css` (line 243) but with a different accent so the two read as different things.
- **Splicing.** The plugin splices each insertion at `heading + 1 + blocksAfter`, in array
  order, so a later insertion at the same index lands above an earlier one. The findings strips
  (`blocksAfter: 0`) are already spliced after the videos and demos, so they sit above them.
  The story insertions are appended after the strips (end of `insertions`), with
  `afterHeading` from the existing `findingsHeading` and `blocksAfter: 0`. Result under each
  chapter's first heading: story box, findings strip, then videos and demos.

## Constraints

- The core invariant and all Rust code are untouched; `results.json` is untouched;
  `docs/levels/*.md` stay byte-identical (they are rustdoc modules).
- `claims.test.mjs` coverage: any comparison stated in words must be tested. Story and
  glossary text states none of its own: it only names clues the strips and level pages already
  state. The one comparison it may repeat is "level 2 on one thread beats level 1 on every
  thread", covered by the test "the first clue" (line 323).
- Node runs only through `web/dev/node.sh`.
- `check-dist.mjs` rules hold: one `<h1>`, no `<script>` without a demo, no `crate::`, no
  `{{`, and no NaN/undefined/Infinity/null on paper pages, so no definition or story text may
  contain those words (the glossary test checks this).

## Testing

New `web/site/src/plugins/remark-glossary.test.mjs` (runs under the existing `npm test` glob):

- Every term parsed from the primer has a non-empty definition; the split and parenthesis
  rules give the expected term list.
- Nothing is wrapped inside code spans, code blocks, headings, links, table cells, or raw
  html; the primer page itself is unchanged.
- First occurrence only: a term used three times yields one `.term`.
- Escaping: a definition containing `& < > "` is escaped; no forbidden words in any
  definition.
- Longest term first: "last-level cache" is not split by "cache".
- Dead weight: every primer term (after splitting) is marked on at least one real page
  rendered from `docs/`; exceptions are listed in the test by name, with a reason each.

New `web/site/src/results/story.test.mjs`, beside `findings.test.mjs`:

- `levelStory` has exactly the six level chapters, with the right label per level.
- Exactly one `<aside class="story">` insertion per level chapter, placed before the findings
  strip's insertion in its splice order (story insertions come after the strip in the array),
  with the same heading and `blocksAfter` 0, and no other insertion at that spot after them.
- No `{{`, NaN or undefined; no `[&<>]` in the story text; each box carries its label and the
  words "This level:".

`findings.test.mjs` changes in one place: its "an insertion after the strip lands above it"
check must now exempt story insertions (it fails otherwise by design). Build check:
`check-dist.mjs` gains a check that the Discussion contains at least one `class="term"` and
every level chapter has one `class="story"`.

## Out of scope

- JavaScript tooltips, touch gestures beyond tap-to-focus, or a standalone glossary page.
- Marking terms on the primer, the playground, or the results tables.
- Changing `docs/levels/*.md`, benchmark data, claims, or any Rust.
- Per-term links back to the primer.
