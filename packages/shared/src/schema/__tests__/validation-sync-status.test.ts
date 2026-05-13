import { describe, expect, it } from 'vitest';

import {
  graphifyRunStatusSchema,
  insertWikiPageSchema,
  proposalTypeSchema,
  syncStatusSchema,
} from '../validation.js';

describe('sync status validation', () => {
  it.each(['synced', 'sync_pending', 'reindex_pending', 'conflict_required'] as const)(
    'accepts %s as a wiki page sync status',
    (status) => {
      expect(syncStatusSchema.safeParse(status).success).toBe(true);
    },
  );

  it('accepts governance merge redirect sync statuses', () => {
    expect(syncStatusSchema.safeParse('redirect:target-page').success).toBe(true);
    expect(syncStatusSchema.safeParse('redirect:').success).toBe(false);
  });

  it('rejects invalid sync status values', () => {
    expect(syncStatusSchema.safeParse('pending').success).toBe(false);
    expect(syncStatusSchema.safeParse('graphify_suggestion').success).toBe(false);
  });

  it('round-trips wiki page sync fields through insertWikiPageSchema', () => {
    const parsed = insertWikiPageSchema.parse({
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      page_id: 'space-1.index.root',
      title: 'Index',
      slug: 'index',
      sync_status: 'sync_pending',
      docmost_page_id: 'docmost-page-1',
    });

    expect(parsed).toMatchObject({
      sync_status: 'sync_pending',
      docmost_page_id: 'docmost-page-1',
    });
  });
});

describe('proposal type validation', () => {
  it('accepts conflict proposals and rejects the old graphify_suggestion value', () => {
    expect(proposalTypeSchema.safeParse('conflict').success).toBe(true);
    expect(proposalTypeSchema.safeParse('graphify_suggestion').success).toBe(false);
  });
});

describe('graphify run status validation', () => {
  it.each(['docmost_syncing', 'docmost_synced', 'docmost_sync_failed'] as const)(
    'accepts %s as a graphify run status',
    (status) => {
      expect(graphifyRunStatusSchema.safeParse(status).success).toBe(true);
    },
  );
});
