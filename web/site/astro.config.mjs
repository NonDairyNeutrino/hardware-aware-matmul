import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import remarkRustdoc from './src/plugins/remark-rustdoc.mjs';
import { base, insertions, links } from './site.config.mjs';

export default defineConfig({
  base,
  trailingSlash: 'always',
  vite: { worker: { format: 'es' } },
  markdown: {
    processor: unified({ remarkPlugins: [[remarkRustdoc, { base, links, insertions }]] }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
  },
});
