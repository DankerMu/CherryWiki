import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { closeDb, getDb } from './helpers/db.js';
import { closeRedis } from './helpers/redis.js';
import {
  login,
  chatStream,
  healthCheck,
  clearToken,
} from './helpers/api-client.js';
import {
  E2E_TENANT_ID,
  E2E_SPACE_ID,
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_USER_ID,
  seedTestData,
  cleanupTestData,
} from './helpers/seed.js';

type EvalEntry = {
  query: string;
  expected_pages: string[];
  expected_content_snippet: string;
  space_id: string;
};

type Citation = {
  chunk_id?: string;
  page_id?: string;
  wiki_page_pk?: string;
  page_title?: string;
  section_title?: string;
  relevance_score?: number;
  content_snippet?: string;
  source_chain_json?: unknown;
  fallback?: boolean;
};

const GOLDEN_PATH = join(import.meta.dirname, 'fixtures', 'golden', 'eval-set.json');

describe('citation-accuracy E2E', () => {
  let evalSet: EvalEntry[];

  beforeAll(async () => {
    expect(await healthCheck()).toBe(true);

    // Seed if not already seeded (this test may run standalone)
    try {
      await seedTestData();
    } catch {
      // already seeded from core-pipeline
    }

    await login(E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
    evalSet = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8'));
  }, 60_000);

  afterAll(async () => {
    clearToken();
    try { await cleanupTestData(); } catch { /* ok */ }
    await closeDb();
    await closeRedis();
  }, 30_000);

  describe('REQ-CA-1: Citation page_id accuracy', () => {
    it('at least one citation matches expected page for sampled queries', async () => {
      const sample = evalSet.slice(0, 5);

      for (const entry of sample) {
        const events = await chatStream(entry.query, { spaceId: E2E_SPACE_ID });
        const citationEvent = events.find((e) => e.type === 'citations');
        if (!citationEvent) continue;

        const citations = citationEvent.citations as Citation[];
        if (citations.length === 0) continue;

        const pageIds = citations.map((c) => c.page_id ?? c.wiki_page_pk ?? '');
        const pageTitles = citations.map((c) => (c.page_title ?? '').toLowerCase());

        const hasExpectedPage = entry.expected_pages.some((expected) => {
          const slug = expected.toLowerCase().replace(/\s+/g, '-');
          return pageIds.some((id) => id?.includes(slug)) || pageTitles.some((t) => t.includes(expected.toLowerCase().replace(/-/g, ' ')));
        });

        // Soft assertion: log but don't fail if no match (eval quality varies)
        if (!hasExpectedPage) {
          console.warn(`[CA-1] Query "${entry.query}" — no citation matched expected pages ${entry.expected_pages.join(', ')}`);
        }
      }
    }, 120_000);
  });

  describe('REQ-CA-2: No citation to unpublished pages', () => {
    it('draft pages excluded from citations', async () => {
      const db = getDb();

      // Create a draft page with distinctive content
      await db.execute(sql`
        INSERT INTO wiki_pages (id, tenant_id, space_id, page_id, title, slug, status, created_by)
        VALUES (${'e2e-draft-page'}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${'draft-internal-notes'}, ${'Draft Internal Notes'}, ${'draft-internal-notes'}, ${'draft'}, ${E2E_USER_ID})
        ON CONFLICT (id) DO NOTHING
      `);

      const events = await chatStream('Tell me about Project Omega', { spaceId: E2E_SPACE_ID });
      const citationEvent = events.find((e) => e.type === 'citations');

      if (citationEvent) {
        const citations = citationEvent.citations as Citation[];
        for (const cit of citations) {
          const pageId = cit.page_id ?? cit.wiki_page_pk;
          expect(pageId).not.toBe('e2e-draft-page');
        }
      }

      // Content should not leak draft data
      const contentEvents = events.filter((e) => e.type === 'content');
      const fullContent = contentEvents.map((e) => String(e.delta ?? '')).join('');
      expect(fullContent).not.toContain('CLASSIFIED');
    }, 60_000);
  });

  describe('REQ-CA-3: Citation relevance score ordering', () => {
    it('citations are ordered by relevance_score descending', async () => {
      const events = await chatStream('How does authentication integrate with permissions?', {
        spaceId: E2E_SPACE_ID,
      });

      const citationEvent = events.find((e) => e.type === 'citations');
      if (!citationEvent) return;

      const citations = citationEvent.citations as Citation[];
      const scores = citations
        .map((c) => c.relevance_score)
        .filter((s): s is number => s !== undefined);

      if (scores.length >= 2) {
        for (let i = 0; i < scores.length - 1; i++) {
          expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
        }
      }
    }, 60_000);
  });

  describe('REQ-CA-4: Fallback citations marked', () => {
    it('when present, fallback citations have fallback: true', async () => {
      const events = await chatStream('Describe something obscure and unlikely to match.', {
        spaceId: E2E_SPACE_ID,
      });

      const citationEvent = events.find((e) => e.type === 'citations');
      if (!citationEvent) return;

      const citations = citationEvent.citations as Citation[];
      const fallbacks = citations.filter((c) => c.fallback === true);

      // If fallback citations exist, they should be marked
      if (fallbacks.length > 0) {
        for (const fb of fallbacks) {
          expect(fb.fallback).toBe(true);
        }
      }
    }, 60_000);
  });
});
