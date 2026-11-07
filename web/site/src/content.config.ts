import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Only the paper's pages (the levels and docs/paper/; docs/introduction.md is the crate's rustdoc front page); never docs/** (that
// tree also holds docs/superpowers/).
// `../../docs` is web/site/../../docs on the host and /work/site/../../docs = /docs
// in the Node container (web/dev/node.sh mounts docs/ there, read-only).
const chapters = defineCollection({
  loader: glob({ pattern: ['levels/*.md', 'paper/*.md'], base: '../../docs' }),
});

export const collections = { chapters };
