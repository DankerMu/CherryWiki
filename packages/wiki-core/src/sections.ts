import type { WikiSection } from './types.js';

const headingPattern = /^(#{2,3})(?!#)[ \t]+(.+?)\s*#*\s*$/gm;

function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function extractSections(markdown: string, pageId: string): WikiSection[] {
  const matches = Array.from(markdown.matchAll(headingPattern));

  return matches.map((match, index) => {
    const heading = (match[2] ?? '').trim().replace(/\s+#*$/, '');
    const nextMatch = matches[index + 1];
    const level = match[1]?.length ?? 2;
    const startOffset = match.index ?? 0;

    return {
      section_id: `${pageId}#heading-${slugifyHeading(heading)}`,
      heading,
      level,
      section_index: index,
      start_offset: startOffset,
      end_offset: nextMatch?.index ?? markdown.length,
      content_hash: null,
    };
  });
}
