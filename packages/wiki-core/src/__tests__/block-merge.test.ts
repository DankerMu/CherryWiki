import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type BlockMatchResult,
  type BlockMetadataInfo,
  matchBlocksFallback,
  mergeBlocks,
  normalizeBlockHash,
} from '../normalization/block-merge.js';

describe('block merge', () => {
  describe('normalizeBlockHash', () => {
    it('normalizes trailing whitespace and CRLF line endings', () => {
      const left = '## Overview\r\nAlpha   \r\nBeta\t\r\n';
      const right = '## Overview\nAlpha\nBeta';

      expect(normalizeBlockHash(left)).toBe(normalizeBlockHash(right));
    });

    it('excludes graphify marker lines from the hash', () => {
      const marked = [
        '<!-- graphify:managed:start id="overview" run="gf-1" -->',
        '## Overview',
        'Alpha',
        '<!-- graphify:managed:end -->',
      ].join('\n');
      const unmarked = '## Overview\nAlpha';

      expect(normalizeBlockHash(marked)).toBe(normalizeBlockHash(unmarked));
    });

    it('returns deterministic SHA-256 hex output', () => {
      const content = '## Overview\nAlpha';

      expect(normalizeBlockHash(content)).toBe(
        createHash('sha256').update(content).digest('hex'),
      );
      expect(normalizeBlockHash(content)).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('matchBlocksFallback', () => {
    it('matches blocks by H2 heading-derived block ID', () => {
      const markdown = '## Overview\nHuman edit\n\n## Details\nMore';
      const sidecar = [
        metadata({ blockId: 'overview', content: '## Overview\nOriginal' }),
        metadata({ blockId: 'details', content: '## Details\nMore' }),
      ];

      expect(matchBlocksFallback(markdown, sidecar)).toMatchObject([
        { blockId: 'overview', matchType: 'heading', matchedMetadata: sidecar[0] },
        { blockId: 'details', matchType: 'heading', matchedMetadata: sidecar[1] },
      ]);
    });

    it('falls back to fuzzy content-hash matching when the heading changed', () => {
      const content = '## Renamed\nOriginal content';
      const hash = normalizeBlockHash(content);
      const sidecar = [
        {
          ...metadata({ blockId: 'original-title', content: '## Original Title\nOriginal content' }),
          contentHash: `${hash.slice(0, -1)}${hash.endsWith('a') ? 'b' : 'a'}`,
        },
      ];

      const [result] = matchBlocksFallback(content, sidecar);

      expect(result).toMatchObject({
        blockId: 'original-title',
        matchType: 'hash',
        matchedMetadata: sidecar[0],
      });
    });

    it('marks unmatched markdown blocks as new and omits deleted sidecar blocks', () => {
      const markdown = '## New Section\nDraft';
      const sidecar = [metadata({ blockId: 'deleted-section', content: '## Deleted Section\nGone' })];

      const results = matchBlocksFallback(markdown, sidecar);

      expect(results).toEqual([
        {
          blockId: 'new-section',
          content: '## New Section\nDraft',
          matchType: 'new',
        },
      ]);
      expect(results.some((result) => result.blockId === 'deleted-section')).toBe(false);
    });
  });

  describe('mergeBlocks', () => {
    it('transfers graphify ownership to human when content changes', () => {
      const existing = metadata({
        blockId: 'overview',
        owner: 'graphify',
        content: '## Overview\nGraphify content',
        graphifyRunId: 'gf-1',
        editable: false,
      });
      const result = mergeBlocks(
        [matched({ blockId: 'overview', content: '## Overview\nHuman edit', matchedMetadata: existing })],
        'user-1',
      );

      expect(result.newMetadata[0]).toMatchObject({
        blockId: 'overview',
        owner: 'human',
        lastEditor: 'user-1',
        graphifyRunId: 'gf-1',
        editable: true,
        contentHash: normalizeBlockHash('## Overview\nHuman edit'),
      });
      expect(result.proposals).toEqual([]);
    });

    it('keeps unchanged graphify blocks as-is', () => {
      const existing = metadata({
        blockId: 'overview',
        owner: 'graphify',
        content: '## Overview\nGraphify content',
        editable: false,
      });
      const result = mergeBlocks([
        matched({ blockId: 'overview', content: '## Overview\nGraphify content', matchedMetadata: existing }),
      ]);

      expect(result.newMetadata[0]).toEqual(existing);
    });

    it('updates human-owned block hash and editor when content changes', () => {
      const existing = metadata({
        blockId: 'notes',
        owner: 'human',
        content: '## Notes\nOriginal',
        lastEditor: 'user-old',
      });
      const result = mergeBlocks(
        [matched({ blockId: 'notes', content: '## Notes\nUpdated', matchedMetadata: existing })],
        'user-new',
      );

      expect(result.newMetadata[0]).toMatchObject({
        blockId: 'notes',
        owner: 'human',
        lastEditor: 'user-new',
        editable: true,
        contentHash: normalizeBlockHash('## Notes\nUpdated'),
      });
    });

    it('creates human-owned metadata for new blocks and concatenates content', () => {
      const result = mergeBlocks(
        [
          { blockId: 'first', content: '## First\nA', matchType: 'new' },
          { blockId: 'second', content: '## Second\nB', matchType: 'new' },
        ],
        'user-1',
      );

      expect(result.mergedMarkdown).toBe('## First\nA\n\n## Second\nB');
      expect(result.newMetadata).toEqual([
        {
          blockId: 'first',
          owner: 'human',
          contentHash: normalizeBlockHash('## First\nA'),
          lastEditor: 'user-1',
          editable: true,
        },
        {
          blockId: 'second',
          owner: 'human',
          contentHash: normalizeBlockHash('## Second\nB'),
          lastEditor: 'user-1',
          editable: true,
        },
      ]);
    });
  });
});

function metadata(overrides: {
  blockId: string;
  owner?: 'graphify' | 'human';
  content: string;
  graphifyRunId?: string;
  lastEditor?: string;
  editable?: boolean;
}): BlockMetadataInfo {
  return {
    blockId: overrides.blockId,
    owner: overrides.owner ?? 'human',
    contentHash: normalizeBlockHash(overrides.content),
    ...(overrides.graphifyRunId !== undefined ? { graphifyRunId: overrides.graphifyRunId } : {}),
    ...(overrides.lastEditor !== undefined ? { lastEditor: overrides.lastEditor } : {}),
    editable: overrides.editable ?? true,
  };
}

function matched(args: {
  blockId: string;
  content: string;
  matchedMetadata: BlockMetadataInfo;
}): BlockMatchResult {
  return {
    blockId: args.blockId,
    content: args.content,
    matchedMetadata: args.matchedMetadata,
    matchType: 'heading',
  };
}
