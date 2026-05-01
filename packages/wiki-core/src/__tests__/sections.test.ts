import { describe, expect, it } from 'vitest';

import { extractSections } from '../sections.js';

describe('extractSections', () => {
  it('extracts h2 and h3 headings', () => {
    const sections = extractSections('# Title\n\n## Section A\n\nText\n\n### Sub\n\n## Section B', 'page-1');

    expect(sections).toHaveLength(3);
    expect(sections.map((section) => section.heading)).toEqual(['Section A', 'Sub', 'Section B']);
  });

  it('excludes h1 headings', () => {
    expect(extractSections('# Title', 'page-1')).toEqual([]);
  });

  it('handles empty markdown', () => {
    expect(extractSections('', 'page-1')).toEqual([]);
  });

  it('generates section ids from page id and heading slug', () => {
    const [section] = extractSections('## Section A', 'page-1');

    expect(section?.section_id).toBe('page-1#heading-section-a');
  });

  it('returns correct heading levels', () => {
    const sections = extractSections('## Section A\n\n### Sub', 'page-1');

    expect(sections.map((section) => section.level)).toEqual([2, 3]);
  });

  it('uses sequential section indexes starting from zero', () => {
    const sections = extractSections('## A\n\n### B\n\n## C', 'page-1');

    expect(sections.map((section) => section.section_index)).toEqual([0, 1, 2]);
  });
});
