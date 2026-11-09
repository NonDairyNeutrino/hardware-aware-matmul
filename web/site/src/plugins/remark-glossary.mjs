// Shows the primer's definitions in place: the first plain-prose use of each defined term on a
// chapter becomes a focusable span whose definition appears on hover or keyboard focus (CSS
// only, no script, so a chapter without a demo stays script-free).
//
// The terms come from the primer's "Terms used in the chapters" table (docs/paper/primer.md),
// read once when the site is configured; a primer without that table FAILS the build. A cell
// such as "block, tile" gives two terms, "last-level cache (LLC)" gives the long form and the
// short one, and every term of a row shares its meaning (backticks dropped).
//
// Runs after remark-rustdoc, so placeholders are numbers and crate:: links are rewritten.
// Applies to chapters under levels/ and paper/, except the primer (it defines the terms).
// Matching is by whole word, in any case, longest term first, with an optional plural "s" or
// "es"; code, headings, link text, table cells and raw HTML (every insertion from
// site.config.mjs) are never marked, and a term is marked once per page.
import { readFileSync } from 'node:fs';
import { chapterId } from './remark-rustdoc.mjs';

const TABLE_HEADING = '# Terms used in the chapters';

/** The terms of one table cell: "a, b" gives both, "long (SHORT)" gives the long form and SHORT. */
export function splitTerm(cell) {
  const paren = /^(.*?)\s*\(([^)]*)\)$/.exec(cell.trim());
  const forms = paren ? [paren[1], paren[2]] : [cell];
  return forms.flatMap((form) => form.split(',')).map((term) => term.trim()).filter(Boolean);
}

/** [{ term, meaning }] from the primer's Markdown; throws if the table is missing, empty or malformed. */
export function parseTerms(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === TABLE_HEADING);
  if (start === -1) throw new Error(`primer: no "${TABLE_HEADING}" table`);
  const table = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) table.push(line);
    else if (table.length > 0 || line.trim() !== '') break;
  }
  if (table.length < 3) throw new Error(`primer: the "${TABLE_HEADING}" table has no rows`);
  // table[0] is the header row, table[1] the |---| separator.
  return table.slice(2).flatMap((line) => {
    const cells = line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
    const meaning = (cells[1] ?? '').replaceAll('`', '').trim();
    if (cells.length !== 2 || cells[0] === '' || meaning === '') {
      throw new Error(`primer: malformed terms row "${line}"`);
    }
    return splitTerm(cells[0]).map((term) => ({ term, meaning }));
  });
}

/** The terms of the primer at `path` (a file path). */
export function loadTerms(path) {
  return parseTerms(readFileSync(path, 'utf8'));
}

export function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Whether the chapter with this id (see chapterId) gets its terms marked. */
export function marksChapter(id) {
  return id !== null && (id.startsWith('levels/') || id.startsWith('paper/')) && id !== 'paper/primer';
}

/**
 * One global, case-insensitive regex matching any of the terms as a whole word (not inside a
 * longer word or a hyphenated or snake_case compound), longest first, with an optional plural
 * "s"/"es". Group 1 is the term as written; null when there are no terms.
 */
export function termPattern(terms) {
  const alternatives = [...new Set(terms.map(({ term }) => term.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  if (alternatives.length === 0) return null;
  return new RegExp(`(?<![\\w-])(${alternatives.join('|')})(?:e?s)?(?![\\w-])`, 'gi');
}

// Node types whose text is never marked (their whole subtree is skipped).
const SKIP = new Set(['heading', 'link', 'linkReference', 'tableCell', 'inlineCode', 'code', 'html']);

/**
 * @param {object} options
 * @param {{term: string, meaning: string}[]} options.terms  from loadTerms
 */
export default function remarkGlossary({ terms = [] } = {}) {
  const meanings = new Map(terms.map(({ term, meaning }) => [term.toLowerCase(), meaning]));
  const pattern = termPattern(terms);
  return (tree, file) => {
    if (pattern === null || !marksChapter(chapterId(file.path))) return;
    const used = new Set();
    const mark = (node) => {
      const parts = [];
      let last = 0;
      for (const match of node.value.matchAll(pattern)) {
        const key = match[1].toLowerCase();
        if (used.has(key)) continue;
        used.add(key);
        const id = `g-${used.size}`;
        if (match.index > last) parts.push({ type: 'text', value: node.value.slice(last, match.index) });
        parts.push({
          type: 'html',
          value:
            `<span class="term" tabindex="0" aria-describedby="${id}"><span>${escapeHtml(match[0])}</span>` +
            `<span class="tip" role="tooltip" id="${id}">${escapeHtml(meanings.get(key))}</span></span>`,
        });
        last = match.index + match[0].length;
      }
      if (parts.length === 0) return [node];
      if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
      return parts;
    };
    // Depth-first, in document order, so "first" means first on the page.
    const walk = (parent) => {
      parent.children = parent.children.flatMap((child) => {
        if (child.type === 'text') return mark(child);
        if (child.children && !SKIP.has(child.type)) walk(child);
        return [child];
      });
    };
    walk(tree);
  };
}
