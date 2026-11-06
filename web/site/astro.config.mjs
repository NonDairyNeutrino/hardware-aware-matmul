import { defineConfig } from 'astro/config';

// GitHub Pages serves this repository at /matmul_levels.rs/.
export default defineConfig({
  base: '/matmul_levels.rs/',
  trailingSlash: 'always',
  vite: { worker: { format: 'es' } },
});
