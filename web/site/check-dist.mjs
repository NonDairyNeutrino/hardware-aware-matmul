// Checks the built site (dist/) for the things that must never ship:
//   - intra-doc link text ("crate::") or rustdoc-hidden lines ("Ok::<") in any page;
//   - a chapter that is missing, or that does not have exactly one <h1>;
//   - a chapter that loads the service worker, directly or through any script it
//     loads (only pages that need threads may: it forces a reload, and readers of
//     the chapters must never see one);
//   - a chapter that has a step-through demo in site.config.mjs but not in its page,
//     a page with a demo it should not have, or a chapter without a demo that loads
//     any script at all;
//   - an unlinked intra-doc shortcut left as literal "[code]" text;
//   - a landing page that is not headed by the site title and subtitle with the abstract
//     under them;
//   - a playground page that is missing, has no script, or whose scripts never load the service
//     worker (it is the one reading page that may, so that readers can use the threaded build);
//     and a Results page that does not link to it;
//   - a paper page (abstract, results, discussion, conclusion) with an unresolved `{{...}}`
//     placeholder or a NaN/undefined/Infinity/null where a number should be, and a Results page
//     whose count of tables or charts differs from what site.config.mjs inserts;
//   - a video the pages reference that was not copied into dist/media/;
//   - a production build (GATE unset) that contains the gates' test pages under gate/, or a
//     gate build (GATE=1) that lacks them.
// Run it with `npm run check` after `npm run build`. Exits 1 on any problem.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, chapters, demos, extraPages, insertions, siteSubtitle, siteTitle } from './site.config.mjs';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
const problems = [];

function* pages(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* pages(path);
    else if (entry.name === 'index.html') yield path;
  }
}

// The scripts a page loads (script tags and module preloads), and every script those
// import in turn, as file names under dist/. Rollup names its chunks `name-hash.js`
// and imports them by that name, so a name found in a script that exists in dist is
// an import.
function reachableScripts(html) {
  const found = new Set();
  const queue = [...html.matchAll(/(?:src|href)="[^"]*\/([\w.-]+\.js)"/g)].map((m) => m[1]);
  while (queue.length > 0) {
    const name = queue.pop();
    const file = join(dist, '_astro', name);
    if (found.has(name) || !existsSync(file)) continue;
    found.add(name);
    for (const [, next] of readFileSync(file, 'utf8').matchAll(/([\w.-]+\.js)/g)) queue.push(next);
  }
  return [...found];
}

for (const page of pages(dist)) {
  const html = readFileSync(page, 'utf8');
  const name = page.slice(dist.length);
  if (html.includes('crate::')) problems.push(`${name}: contains "crate::" (an unrewritten intra-doc link)`);
  if (/Ok::(&lt;|<)/.test(html)) problems.push(`${name}: contains a rustdoc-hidden line ("Ok::<")`);
  if (/\[<code[^>]*>[^<]*<\/code>\]/.test(html)) problems.push(`${name}: contains an unlinked shortcut shown as "[code]"`);
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
  if (chapter.route === '') {
    const heading = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];
    if (heading !== siteTitle) problems.push(`(home): the <h1> is ${JSON.stringify(heading)}, expected the site title`);
    if (!html.includes(`>${siteSubtitle}<`)) problems.push('(home): the subtitle is missing');
    if (!/<h2[^>]*>Abstract<\/h2>/.test(html)) problems.push('(home): the abstract is missing');
  }
  const where = chapter.route || '(home)';
  if (html.includes('coi-serviceworker')) problems.push(`${where}: loads the service worker; chapters must not`);
  for (const script of reachableScripts(html)) {
    if (/serviceWorker|coi-serviceworker/i.test(readFileSync(join(dist, '_astro', script), 'utf8'))) {
      problems.push(`${where}: its script ${script} refers to the service worker; chapters must not`);
    }
  }
  if (/navigator\.serviceWorker|\.serviceWorker\.register/i.test(html)) {
    problems.push(`${where}: registers a service worker inline; chapters must not`);
  }
  const wanted = demos.filter((d) => d.chapter === chapter.id).map((d) => d.level);
  const present = [...html.matchAll(/<step-through level="(\d)"/g)].map((m) => Number(m[1]));
  if (JSON.stringify(wanted) !== JSON.stringify(present)) {
    problems.push(`${where}: step-through demos for levels [${present}], site.config.mjs says [${wanted}]`);
  }
  if (wanted.length > 0 && reachableScripts(html).length === 0) problems.push(`${where}: has a demo but loads no script`);
  if (wanted.length === 0 && /<script/.test(html)) problems.push(`${where}: has no demo but loads a script`);
  if (chapter.id.startsWith('paper/')) {
    // The pages written from the data must show real numbers.
    if (html.includes('{{')) problems.push(`${where}: contains an unresolved "{{" placeholder`);
    if (/\b(NaN|undefined|Infinity|null)\b/.test(html)) problems.push(`${where}: contains NaN, undefined, Infinity or null`);
  }
  if (chapter.id === 'paper/results') {
    const tables = (html.match(/<table class="results"/g) ?? []).length;
    const charts = (html.match(/<figure class="chart"/g) ?? []).length;
    // Exactly what the generators in site.config.mjs insert on this page, no more or fewer.
    const inserted = insertions.filter((i) => i.chapter === chapter.id).map((i) => i.html).join('');
    const wantTables = (inserted.match(/<table class="results"/g) ?? []).length;
    const wantCharts = (inserted.match(/<figure class="chart"/g) ?? []).length;
    // Only the page's own text counts: the header navigation links the playground on every page.
    const article = /<article[\s\S]*<\/article>/.exec(html)?.[0] ?? '';
    if (!article.includes(`href="${base}playground/`)) problems.push(`${where}: does not link to the playground`);
    if (tables !== wantTables || charts !== wantCharts) {
      problems.push(`${where}: ${tables} tables and ${charts} charts, expected ${wantTables} and ${wantCharts}`);
    }
  }
}

// Pages outside the paper's reading order. The playground may register the service worker (one
// reload, to enable multithreading): it is the only reading page that does, so its scripts MUST
// reference it, and nothing else does (the chapters are checked above).
for (const page of extraPages) {
  const file = join(dist, page.route, 'index.html');
  if (!existsSync(file)) {
    problems.push(`${page.route}: page was not built`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  if (!html.includes('id="playground"')) problems.push(`${page.route}: the playground section is missing`);
  const scripts = reachableScripts(html);
  if (scripts.length === 0) problems.push(`${page.route}: loads no script`);
  else if (!scripts.some((s) => /coi-serviceworker/.test(readFileSync(join(dist, '_astro', s), 'utf8')))) {
    problems.push(`${page.route}: its scripts never load the service worker, so the threaded build could not be enabled`);
  }
}

// The gates' test pages ship only in gate builds (astro.config.mjs builds them when GATE=1).
const gateBuild = process.env.GATE === '1';
const gatePages = [...pages(dist)].filter((page) => page.slice(dist.length).startsWith('gate/'));
if (!gateBuild && gatePages.length > 0) {
  problems.push(`production build contains the gate pages ${gatePages.map((p) => p.slice(dist.length)).join(', ')}; they are built only with GATE=1`);
}
if (gateBuild) {
  for (const route of ['gate', 'gate/step-through']) {
    if (!existsSync(join(dist, route, 'index.html'))) problems.push(`${route}: the gate page was not built (GATE=1)`);
  }
}

if (problems.length > 0) {
  console.error('check-dist: FAIL');
  for (const problem of problems) console.error(' -', problem);
  process.exit(1);
}
console.log(`check-dist: PASS (${[...pages(dist)].length} pages)`);
