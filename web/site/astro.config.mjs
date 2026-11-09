import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkGlossary, { loadTerms } from './src/plugins/remark-glossary.mjs';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links, results } from './site.config.mjs';

// The primer's terms, shown as tooltips in the chapters (remark-glossary runs after
// remark-rustdoc). Read once here: a primer without its terms table fails the build.
const terms = loadTerms(fileURLToPath(new URL('../../docs/paper/primer.md', import.meta.url)));

// The browser gates' own test pages (/gate/, /gate/step-through/ and /gate/migrate/) are built
// only when GATE=1, which the gate scripts set; the production build never contains them.
const gatePages = {
  name: 'gate-pages',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      injectRoute({ pattern: '/gate', entrypoint: './src/gate-pages/index.astro' });
      injectRoute({ pattern: '/gate/step-through', entrypoint: './src/gate-pages/step-through.astro' });
      injectRoute({ pattern: '/gate/migrate', entrypoint: './src/gate-pages/migrate.astro' });
    },
  },
};

export default defineConfig({
  base,
  integrations: process.env.GATE === '1' ? [gatePages] : [],
  trailingSlash: 'always',
  vite: {
    // The playground loads its gate driver (src/playground/gate.js) only in gate builds, so the
    // production build does not ship it.
    define: { __GATE_BUILD__: JSON.stringify(process.env.GATE === '1') },
    worker: {
      format: 'es',
      // Workers (and what they load) go under playground/, inside the service worker's scope:
      // a worker script is matched to a service worker by its own URL, and the playground's
      // workers need the isolation headers that the service worker adds. See main.js.
      rolldownOptions: {
        output: {
          entryFileNames: 'playground/_worker/[name]-[hash].js',
          chunkFileNames: 'playground/_worker/[name]-[hash].js',
          assetFileNames: 'playground/_worker/[name]-[hash].[ext]',
        },
      },
    },
  },
  markdown: {
    processor: unified({
      remarkPlugins: [[remarkRustdoc, { base, links, insertions, results }], [remarkGlossary, { terms }]],
    }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
  },
});
