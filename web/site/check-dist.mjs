// Checks the built site (dist/) for the things that must never ship:
//   - intra-doc link text ("crate::") or rustdoc-hidden lines ("Ok::<") in any page;
//   - a chapter that is missing, or that does not have exactly one <h1>;
//   - a chapter that loads the service worker (only pages that need threads may:
//     it forces a reload, and readers of the chapters must never see one);
//   - a video the pages reference that was not copied into dist/media/.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { base, chapters } from './site.config.mjs';

const dist = new URL('./dist/', import.meta.url).pathname;
const problems = [];

function* pages(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* pages(path);
    else if (entry.name === 'index.html') yield path;
  }
}

for (const page of pages(dist)) {
  const html = readFileSync(page, 'utf8');
  const name = page.slice(dist.length);
  if (html.includes('crate::')) problems.push(`${name}: contains "crate::" (an unrewritten intra-doc link)`);
  if (/Ok::(&lt;|<)/.test(html)) problems.push(`${name}: contains a rustdoc-hidden line ("Ok::<")`);
  for (const [, file] of html.matchAll(new RegExp(`${base}media/([\\w.-]+)`, 'g'))) {
    if (!existsSync(join(dist, 'media', file))) problems.push(`${name}: references media/${file}, which is not in dist/media/`);
  }
}

for (const chapter of chapters) {
  const file = join(dist, chapter.route, 'index.html');
  if (!existsSync(file)) {
    problems.push(`${chapter.route || '(home)'}: page was not built`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const h1 = (html.match(/<h1[ >]/g) ?? []).length;
  if (h1 !== 1) problems.push(`${chapter.route || '(home)'}: ${h1} <h1> elements, expected 1`);
  if (html.includes('coi-serviceworker')) problems.push(`${chapter.route || '(home)'}: loads the service worker; chapters must not`);
}

if (problems.length > 0) {
  console.error('check-dist: FAIL');
  for (const problem of problems) console.error(' -', problem);
  process.exit(1);
}
console.log(`check-dist: PASS (${[...pages(dist)].length} pages)`);
