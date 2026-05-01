import { JSON_SCHEMA, dump, load } from 'js-yaml';

import type { WikiFrontmatter } from './types.js';

const frontmatterPattern = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m;

export function parseFrontmatter(markdown: string): { frontmatter: Partial<WikiFrontmatter>; content: string } {
  const match = frontmatterPattern.exec(markdown);

  if (!match) {
    return { frontmatter: {}, content: markdown };
  }

  const rawFrontmatter = match[1] ?? '';
  const parsed = rawFrontmatter.trim() ? load(rawFrontmatter, { schema: JSON_SCHEMA }) : {};
  const frontmatter =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<WikiFrontmatter>) : {};

  const content = markdown.slice(match[0].length).replace(/^\r?\n/, '');
  return { frontmatter, content };
}

export function generateFrontmatter(frontmatter: WikiFrontmatter, content: string): string {
  const yaml = dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    schema: JSON_SCHEMA,
    sortKeys: false,
  }).trimEnd();

  return `---\n${yaml}\n---\n\n${content}`;
}
