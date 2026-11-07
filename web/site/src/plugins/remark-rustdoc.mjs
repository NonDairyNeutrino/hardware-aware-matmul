// Turns the Markdown in docs/ (written for rustdoc) into site pages.
//
// The same files are the module documentation of the Rust crate (include_str!), so
// they contain rustdoc-isms and no frontmatter. This plugin handles them:
//   - rustdoc-hidden lines inside `rust` fences are removed;
//   - headings are demoted one level (the page layout supplies the title);
//   - intra-doc links (`crate::x`, and `[`x`]` shortcuts) are rewritten through an
//     explicit table, and anything not in the table FAILS the build;
//   - figures and demos are inserted after named headings, so the Markdown stays
//     free of site markup;
//   - `{{metric subject selectors}}` placeholders in text are replaced by numbers from
//     the reference run's data (see ../results/lookup.mjs), so no measured number is ever
//     typed in prose, and a placeholder that does not resolve FAILS the build.
import { visit } from 'unist-util-visit';
import { hasPlaceholder, substitute } from '../results/lookup.mjs';

/** rustdoc hides lines that start with "# " (or are exactly "#") and unescapes "##". */
export function cleanRustFence(value) {
  return value
    .split('\n')
    .filter((line) => !/^\s*#(\s|$)/.test(line))
    .map((line) => line.replace(/^(\s*)##/, '$1#'))
    .join('\n');
}

/** "levels/naive" for ".../docs/levels/naive.md", or null if the file is not under docs/. */
export function chapterId(path) {
  const match = /^.*[\\/]docs[\\/](.+)\.md$/.exec(path ?? '');
  return match ? match[1].replaceAll('\\', '/') : null;
}

function plainText(node) {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(plainText).join('');
}

/**
 * @param {object} options
 * @param {string} options.base        site base path, ending in "/"
 * @param {Record<string, string|null>} options.links
 *        intra-doc link target (without the "crate::" prefix) -> route under `base`,
 *        or null to show the text as plain code
 * @param {{chapter: string, afterHeading: string, html: string, blocksAfter?: number}[]} [options.insertions]
 *        `blocksAfter` (default 0) skips that many blocks after the heading, so a table can
 *        follow the paragraph that introduces it rather than the heading itself
 * @param {object|null} [options.results]  the parsed results.json, for placeholders
 */
export default function remarkRustdoc({ base = '/', links = {}, insertions = [], results = null } = {}) {
  return (tree, file) => {
    const where = file.path ?? 'unknown file';

    const resolve = (raw) => {
      const key = raw.replace(/^crate::/, '');
      if (!Object.prototype.hasOwnProperty.call(links, key)) {
        throw new Error(`${where}: unresolvable doc link "${raw}" (add it to site.config.mjs)`);
      }
      const route = links[key];
      return route === null ? null : base + route;
    };

    visit(tree, 'code', (node) => {
      if (node.lang === 'rust') node.value = cleanRustFence(node.value);
    });

    // Placeholders in running text (not in code spans or fences, which stay literal).
    visit(tree, 'text', (node) => {
      if (hasPlaceholder(node.value)) {
        try {
          node.value = substitute(node.value, results);
        } catch (error) {
          throw new Error(`${where}: ${error.message}`);
        }
      }
      if (node.value.includes('{{')) {
        throw new Error(`${where}: unresolved "{{" in text (a placeholder split by markup, or malformed)`);
      }
    });

    // Figures and demos go in before the headings are demoted (matching is by text).
    const chapter = chapterId(file.path);
    for (const insertion of insertions.filter((i) => i.chapter === chapter)) {
      const index = tree.children.findIndex(
        (node) => node.type === 'heading' && plainText(node) === insertion.afterHeading,
      );
      if (index === -1) {
        throw new Error(`${where}: no heading "${insertion.afterHeading}" to insert after`);
      }
      const at = index + 1 + (insertion.blocksAfter ?? 0);
      if (at > tree.children.length) {
        throw new Error(`${where}: "${insertion.afterHeading}" has fewer than ${insertion.blocksAfter} blocks after it`);
      }
      tree.children.splice(at, 0, { type: 'html', value: insertion.html });
    }

    visit(tree, 'heading', (node) => {
      node.depth = Math.min(node.depth + 1, 6);
    });

    // Reference-style definitions: resolve them, then drop them from the output.
    const definitions = new Map();
    visit(tree, 'definition', (node, index, parent) => {
      definitions.set(node.identifier, resolve(node.url));
      parent.children.splice(index, 1);
      return ['skip', index];
    });

    // [text](crate::x)
    visit(tree, 'link', (node, index, parent) => {
      if (!node.url.startsWith('crate::')) return;
      const url = resolve(node.url);
      if (url === null) parent.children.splice(index, 1, ...node.children);
      else node.url = url;
    });

    // [`x`] and [`x`][y] where a definition exists
    visit(tree, 'linkReference', (node, index, parent) => {
      const url = definitions.get(node.identifier);
      if (url === undefined) throw new Error(`${where}: reference "${node.identifier}" has no definition`);
      if (url === null) parent.children.splice(index, 1, ...node.children);
      else parent.children.splice(index, 1, { type: 'link', url, children: node.children });
    });

    // [`x`] with no definition parses as the text "[", code, and "]".
    const rewriteShortcuts = (parent) => {
      const kids = parent.children;
      for (let i = 1; i < kids.length - 1; i++) {
        const [before, code, after] = [kids[i - 1], kids[i], kids[i + 1]];
        const isShortcut =
          before.type === 'text' && before.value.endsWith('[') &&
          code.type === 'inlineCode' &&
          after.type === 'text' && after.value.startsWith(']') &&
          !/^\]([([])/.test(after.value);
        if (!isShortcut) continue;
        const url = resolve(code.value);
        before.value = before.value.slice(0, -1);
        after.value = after.value.slice(1);
        if (url !== null) kids.splice(i, 1, { type: 'link', url, children: [code] });
      }
    };
    visit(tree, 'paragraph', rewriteShortcuts);
    visit(tree, 'tableCell', rewriteShortcuts);
  };
}
