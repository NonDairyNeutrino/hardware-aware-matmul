import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links, results } from './site.config.mjs';

// The browser gates' own test pages (/gate/ and /gate/step-through/) are built only when GATE=1,
// which the gate scripts set; the production build never contains them.
const gatePages = {
  name: 'gate-pages',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      injectRoute({ pattern: '/gate', entrypoint: './src/gate-pages/index.astro' });
      injectRoute({ pattern: '/gate/step-through', entrypoint: './src/gate-pages/step-through.astro' });
    },
  },
};

export default defineConfig({
  base,
  integrations: process.env.GATE === '1' ? [gatePages] : [],
  trailingSlash: 'always',
  vite: { worker: { format: 'es' } },
  markdown: {
    processor: unified({ remarkPlugins: [[remarkRustdoc, { base, links, insertions, results }]] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
  },
});
