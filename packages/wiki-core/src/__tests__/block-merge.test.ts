import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  type BlockMatchResult,
  type BlockMetadataInfo,
  matchBlocksFallback,
  mergeBlocks,
  normalizeBlockContent,
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

    it('falls back to fuzzy content matching when the heading changed', () => {
      const previousContent = [
        '## Original Title',
        'This section describes the page sync worker and its retry behavior.',
        'Bridge events are exported, merged into wiki markdown, and written as a new version.',
      ].join('\n');
      const content = [
        '## Renamed Title',
        'This section describes the page sync worker and its retry behavior.',
        'Bridge events are exported, merged into wiki markdown, and written as a new version.',
      ].join('\n');
      const sidecar = [
        metadata({
          blockId: 'original-title',
          content: previousContent,
          normalizedContent: previousContent,
        }),
      ];

      const [result] = matchBlocksFallback(content, sidecar);

      expect(result).toMatchObject({
        blockId: 'original-title',
        matchType: 'hash',
        matchedMetadata: sidecar[0],
      });
    });

    it('marks unmatched markdown blocks as new when positional matching is ambiguous', () => {
      const markdown = '## New Section\nDraft';
      const sidecar = [
        metadata({ blockId: 'deleted-section', content: '## Deleted Section\nGone' }),
        metadata({ blockId: 'other-deleted-section', content: '## Other Deleted Section\nGone' }),
      ];

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

    it('matches a heading change by exact body content hash before fuzzy matching', () => {
      const previousContent = '## Overview\n\nThe import keeps curated prose intact.';
      const regeneratedContent = '## Project Overview\n\nThe import keeps curated prose intact.';
      const sidecar = [
        metadata({
          blockId: 'overview',
          owner: 'human',
          content: previousContent,
        }),
      ];

      const [result] = matchBlocksFallback(regeneratedContent, sidecar);
      const mergeResult = mergeBlocks(result ? [result] : [], 'user-1', 'gf-2', sidecar);

      expect(result).toMatchObject({
        blockId: 'overview',
        matchType: 'hash',
        matchedMetadata: sidecar[0],
      });
      expect(mergeResult.newMetadata[0]).toMatchObject({
        blockId: 'overview',
        owner: 'human',
        editable: true,
      });
      expect(mergeResult.mergedMarkdown).not.toContain('graphify:human:retained');
    });

    it('matches by page-local position when exactly one sidecar entry and one incoming block remain', () => {
      const markdown = '## Regenerated\nDifferent generated text.';
      const sidecar = [
        metadata({
          blockId: 'legacy-human-section',
          owner: 'human',
          content: '## Legacy Human Section\nOriginal curated text.',
        }),
      ];

      const [result] = matchBlocksFallback(markdown, sidecar);

      expect(result).toMatchObject({
        blockId: 'legacy-human-section',
        content: markdown,
        matchType: 'position',
        matchedMetadata: sidecar[0],
      });
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

    it('retains completely unmatched human-owned sidecar blocks at the end', () => {
      const overview = metadata({
        blockId: 'overview',
        owner: 'graphify',
        content: '## Overview\nOriginal graphify text',
        editable: false,
      });
      const notes = metadata({
        blockId: 'my-notes',
        owner: 'human',
        content: '## My Notes\nHuman notes that Graphify did not regenerate.',
      });
      const matchedBlocks = matchBlocksFallback('## Overview\nRegenerated graphify text', [overview, notes]);

      const result = mergeBlocks(matchedBlocks, 'user-1', 'gf-2', [overview, notes]);

      expect(result.mergedMarkdown).toContain('## Overview\nRegenerated graphify text');
      expect(result.mergedMarkdown).toContain(
        '<!-- graphify:human:start id="my-notes" retained="true" -->',
      );
      expect(result.mergedMarkdown).toContain('## My Notes\nHuman notes that Graphify did not regenerate.');
      expect(result.mergedMarkdown).toContain('<!-- graphify:human:end -->');
      expect(result.newMetadata.find((block) => block.blockId === 'my-notes')).toMatchObject({
        blockId: 'my-notes',
        owner: 'human',
        contentHash: notes.contentHash,
        editable: true,
      });
    });

    it('retains unmatched human-owned sidecar blocks when positional matching is ambiguous', () => {
      const first = metadata({
        blockId: 'first-human',
        owner: 'human',
        content: '## First Human\nFirst curated block.',
      });
      const second = metadata({
        blockId: 'second-human',
        owner: 'human',
        content: '## Second Human\nSecond curated block.',
      });
      const matchedBlocks = matchBlocksFallback('## Regenerated\nUnrelated regenerated content.', [first, second]);

      const result = mergeBlocks(matchedBlocks, 'user-1', 'gf-2', [first, second]);

      expect(matchedBlocks[0]).toMatchObject({ blockId: 'regenerated', matchType: 'new' });
      expect(result.mergedMarkdown).toContain('## Regenerated\nUnrelated regenerated content.');
      expect(result.mergedMarkdown).toContain('id="first-human"');
      expect(result.mergedMarkdown).toContain('## First Human\nFirst curated block.');
      expect(result.mergedMarkdown).toContain('id="second-human"');
      expect(result.mergedMarkdown).toContain('## Second Human\nSecond curated block.');
      expect(result.newMetadata.filter((block) => block.owner === 'human').map((block) => block.blockId)).toEqual([
        'regenerated',
        'first-human',
        'second-human',
      ]);
    });
  });
});

function metadata(overrides: {
  blockId: string;
  owner?: 'graphify' | 'human';
  content: string;
  normalizedContent?: string;
  graphifyRunId?: string;
  lastEditor?: string;
  editable?: boolean;
}): BlockMetadataInfo {
  return {
    blockId: overrides.blockId,
    owner: overrides.owner ?? 'human',
    contentHash: normalizeBlockHash(overrides.content),
    content: overrides.content,
    normalizedContent: normalizeBlockContent(overrides.normalizedContent ?? overrides.content),
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
