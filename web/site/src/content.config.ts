import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Only the chapters; never docs/** (that tree also holds docs/superpowers/).
// `../../docs` is web/site/../../docs on the host and /work/site/../../docs = /docs
// in the Node container (web/dev/node.sh mounts docs/ there, read-only).
const chapters = defineCollection({
  loader: glob({ pattern: ['introduction.md', 'levels/*.md'], base: '../../docs' }),
});

export const collections = { chapters };
