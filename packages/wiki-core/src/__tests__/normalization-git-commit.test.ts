import { describe, expect, it } from 'vitest';

import { importGraphifyWiki, type ExistingPageInfo } from '../normalization/import-graphify-wiki.js';

describe('normalization git commit info', () => {
  it('formats first import commit messages', () => {
    const result = importGraphifyWiki({
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      spaceSlug: 'space',
      runId: 'run_1',
      communityLabels: ['Auth System'],
      godNodeLabels: [],
      stableKeys: new Map(),
      wikiFiles: new Map([
        ['auth-system.md', '# Auth System\n\n## Overview\nText'],
        ['permission-system.md', '# Permission System\n\n## Overview\nText'],
      ]),
      reportMarkdown: '',
      existingPages: new Map(),
      existingBlockMetadata: new Map(),
      sourceDocumentIds: [],
      now: '2026-05-02T12:00:00.000Z',
    });

    expect(result.gitCommits[0]?.message).toBe(
      '[space][graphify][run_1] add 2 pages: auth-system, permission-system',
    );
  });

  it('formats mixed add and update commit messages', () => {
    const existingPage: ExistingPageInfo = {
      pageId: 'space-1.index.root',
      slug: 'index',
      currentVersionNo: 1,
      status: 'draft',
      pageType: 'index',
    };
    const result = importGraphifyWiki({
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      spaceSlug: 'space',
      runId: 'run_2',
      communityLabels: ['Auth System'],
      godNodeLabels: [],
      stableKeys: new Map(),
      wikiFiles: new Map([
        ['index.md', '# Wiki Index\n\n## Overview\nText'],
        ['auth-system.md', '# Auth System\n\n## Overview\nText'],
      ]),
      reportMarkdown: '',
      existingPages: new Map([[existingPage.pageId, existingPage]]),
      existingBlockMetadata: new Map(),
      sourceDocumentIds: [],
      now: '2026-05-02T12:00:00.000Z',
    });

    expect(result.gitCommits[0]?.message).toBe('[space][graphify][run_2] add 1 page, update 1 page: auth-system, index');
  });
});
