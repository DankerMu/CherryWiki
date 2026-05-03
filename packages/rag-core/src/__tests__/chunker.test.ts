import { describe, expect, it } from 'vitest';

import { chunkPage } from '../chunker.js';

const page = {
  id: 'page-pk-1',
  tenant_id: 'tenant-1',
  space_id: 'space-1',
  page_id: 'page-1',
};

const version = {
  id: 'version-1',
  version_no: 3,
  content_markdown: 'alpha section beta section',
};

describe('chunkPage', () => {
  it('chunks multiple sections and preserves section ids', () => {
    const chunks = chunkPage(page, version, [
      { id: 'section-2', section_index: 2, content: 'Second section content' },
      { id: 'section-1', section_index: 1, content: 'First section content' },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.section_id)).toEqual(['section-1', 'section-2']);
    expect(chunks.map((chunk) => chunk.content)).toEqual(['First section content', 'Second section content']);
  });

  it('splits a large section with token-window overlap', () => {
    const content = makeTokenText(1500);
    const chunks = chunkPage(
      page,
      { ...version, content_markdown: content },
      [{ id: 'section-1', section_index: 0, content }],
      { maxChunkTokens: 512, overlapTokens: 64 },
    );

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.length).toBeLessThanOrEqual(4);
    expect(chunks[0]?.content.slice(-256)).toBe(chunks[1]?.content.slice(0, 256));
    expect(chunks.every((chunk) => chunk.section_id === 'section-1')).toBe(true);
  });

  it('chunks the full page when no sections are provided', () => {
    const chunks = chunkPage(page, { ...version, content_markdown: makeTokenText(700) }, [], {
      maxChunkTokens: 512,
      overlapTokens: 64,
    });

    expect(chunks.length).toBe(2);
    expect(chunks.every((chunk) => chunk.section_id === null)).toBe(true);
  });

  it('returns an empty array for empty page content', () => {
    expect(chunkPage(page, { ...version, content_markdown: '   ' }, [])).toEqual([]);
  });

  it('assigns chunk indexes sequentially across sections', () => {
    const chunks = chunkPage(
      page,
      version,
      [
        { id: 'section-1', section_index: 0, content: makeTokenText(700) },
        { id: 'section-2', section_index: 1, content: 'small' },
      ],
      { maxChunkTokens: 512, overlapTokens: 64 },
    );

    expect(chunks.map((chunk) => chunk.chunk_index)).toEqual([0, 1, 2]);
    expect(chunks.map((chunk) => chunk.section_id)).toEqual(['section-1', 'section-1', 'section-2']);
  });

  it('computes stable content hashes', () => {
    const first = chunkPage(page, version, [{ id: 'section-1', section_index: 0, content: 'same content' }]);
    const second = chunkPage(page, version, [{ id: 'section-1', section_index: 0, content: 'same content' }]);
    const third = chunkPage(page, version, [{ id: 'section-1', section_index: 0, content: 'different content' }]);

    expect(first[0]?.content_hash).toBe(second[0]?.content_hash);
    expect(first[0]?.content_hash).not.toBe(third[0]?.content_hash);
  });
});

function makeTokenText(tokenCount: number): string {
  return Array.from({ length: tokenCount }, (_, index) => String(index % 10).repeat(4)).join('');
}
