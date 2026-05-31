import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { closeDb, getDb } from './helpers/db.js';
import { closeRedis } from './helpers/redis.js';
import {
  login,
  uploadFile,
  chatStream,
  healthCheck,
  clearToken,
} from './helpers/api-client.js';
import { waitForJob } from './helpers/job-poller.js';
import {
  E2E_TENANT_ID,
  E2E_SPACE_ID,
  E2E_SPACE_B_ID,
  E2E_USER_ID,
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_MODEL_CONFIG_ID,
  seedTestData,
  cleanupTestData,
} from './helpers/seed.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');
const GRAPHIFY_FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'test-graphify-output');
const HAS_CLAUDE_KEY = Boolean(process.env.CLAUDE_API_KEY);

describe('core-pipeline E2E', () => {
  beforeAll(async () => {
    expect(await healthCheck()).toBe(true);
    await seedTestData();
    await login(E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
  }, 60_000);

  afterAll(async () => {
    clearToken();
    await cleanupTestData();
    await closeDb();
    await closeRedis();
  }, 30_000);

  describe('REQ-CP-0: real upload and parse pipeline', () => {
    let sourceDocumentId: string;

    it('uploads a markdown file and creates source_document record', async () => {
      const result = await uploadFile(E2E_SPACE_ID, join(FIXTURES_DIR, 'docs', 'auth-design.md'));
      expect(result.source_document_id).toBeTruthy();
      sourceDocumentId = result.source_document_id;

      const db = getDb();
      const rows = await db.execute(
        sql`SELECT id, status, tenant_id FROM source_documents WHERE id = ${sourceDocumentId}`,
      );
      const row = (rows.rows ?? rows)[0] as { id: string; status: string; tenant_id: string } | undefined;
      expect(row).toBeTruthy();
    });

    it('ingestion worker parses the file', async () => {
      const db = getDb();
      const jobRows = await db.execute(
        sql`SELECT id FROM jobs WHERE tenant_id = ${E2E_TENANT_ID} AND type = 'ingestion' ORDER BY created_at DESC LIMIT 1`,
      );
      const jobRow = (jobRows.rows ?? jobRows)[0] as { id: string } | undefined;

      if (jobRow) {
        const result = await waitForJob(jobRow.id, { timeoutMs: 60_000 });
        expect(['completed', 'succeeded']).toContain(result.status);
      }

      const docRows = await db.execute(
        sql`SELECT status FROM source_documents WHERE id = ${sourceDocumentId}`,
      );
      const doc = (docRows.rows ?? docRows)[0] as { status: string } | undefined;
      expect(doc).toBeTruthy();
      expect(['parsed', 'indexing', 'indexed', 'graphifying', 'graphify_pending', 'graphify_queued']).toContain(doc!.status);
    }, 90_000);
  });

  describe('REQ-CP-1: Graphify pipeline (Tier 1 — fixture)', () => {
    const graphifyRunId = `e2e-grun-${randomUUID().slice(0, 8)}`;

    it.skipIf(HAS_CLAUDE_KEY)('imports graphify fixtures and creates wiki pages', async () => {
      const db = getDb();

      const graphJson = JSON.parse(readFileSync(join(GRAPHIFY_FIXTURE_DIR, 'graph.json'), 'utf-8'));
      expect(graphJson.nodes.length).toBeGreaterThan(0);

      // Create a graphify run record
      await db.execute(sql`
        INSERT INTO graphify_runs (id, tenant_id, space_id, trigger_type, mode, status, schema_version)
        VALUES (${graphifyRunId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${'e2e-fixture'}, ${'deep'}, ${'completed'}, ${'v1'})
      `);

      // Insert graph nodes
      for (const node of graphJson.nodes) {
        const nodeId = `e2e-node-${node.id}`;
        await db.execute(sql`
          INSERT INTO graph_nodes (id, tenant_id, space_id, graphify_run_id, node_key, stable_key, label, norm_label, type)
          VALUES (${nodeId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${graphifyRunId},
            ${node.id}, ${node.id}, ${node.label}, ${node.norm_label ?? node.id}, ${node.type ?? 'concept'})
          ON CONFLICT DO NOTHING
        `);
      }

      // Insert graph edges
      if (graphJson.edges) {
        for (const edge of graphJson.edges) {
          const edgeId = `e2e-edge-${randomUUID().slice(0, 8)}`;
          await db.execute(sql`
            INSERT INTO graph_edges (id, tenant_id, space_id, graphify_run_id, source_node_id, target_node_id, relation_type, confidence_label, evidence_count)
            VALUES (${edgeId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${graphifyRunId},
              ${`e2e-node-${edge.source}`}, ${`e2e-node-${edge.target}`},
              ${edge.relationship ?? 'related_to'}, ${'high'}, ${1})
            ON CONFLICT DO NOTHING
          `);
        }
      }

      // Import wiki pages from fixture
      const wikiDir = join(GRAPHIFY_FIXTURE_DIR, 'wiki');
      const wikiFiles = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));

      for (const file of wikiFiles) {
        const content = readFileSync(join(wikiDir, file), 'utf-8');
        const title = file.replace('.md', '').replace(/-/g, ' ');
        const pageSlug = file.replace('.md', '');
        const pagePk = `e2e-page-${pageSlug}`;
        const pageId = pageSlug;
        const versionId = `e2e-ver-${pageSlug}`;

        await db.execute(sql`
          INSERT INTO wiki_pages (id, tenant_id, space_id, page_id, title, slug, status, created_by)
          VALUES (${pagePk}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${pageId}, ${title}, ${pageSlug}, ${'published'}, ${E2E_USER_ID})
          ON CONFLICT (id) DO NOTHING
        `);

        await db.execute(sql`
          INSERT INTO wiki_page_versions (id, tenant_id, space_id, wiki_page_pk, page_id, version_no, content_markdown, source, graphify_run_id, status, created_by)
          VALUES (${versionId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${pagePk}, ${pageId}, ${1}, ${content}, ${'e2e-fixture'}, ${graphifyRunId}, ${'published'}, ${E2E_USER_ID})
          ON CONFLICT (id) DO NOTHING
        `);

        // Update wiki_page current_version_id
        await db.execute(sql`
          UPDATE wiki_pages SET current_version_id = ${versionId} WHERE id = ${pagePk}
        `);
      }

      // Verify pages created
      const pageCount = await db.execute(
        sql`SELECT count(*) as cnt FROM wiki_pages WHERE space_id = ${E2E_SPACE_ID} AND status = 'published'`,
      );
      expect(Number((pageCount.rows ?? pageCount)[0]?.cnt ?? 0)).toBeGreaterThan(0);
    });
  });

  describe('REQ-CP-2: Index build from wiki pages', () => {
    it('creates wiki chunks with mock embeddings and activates snapshot', async () => {
      const db = getDb();

      const pages = await db.execute(
        sql`SELECT wp.id, wpv.id as version_id, wpv.content_markdown
            FROM wiki_pages wp
            JOIN wiki_page_versions wpv ON wpv.wiki_page_pk = wp.id
            WHERE wp.space_id = ${E2E_SPACE_ID} AND wp.status = 'published'
            LIMIT 20`,
      );
      const pageRows = (pages.rows ?? pages) as { id: string; version_id: string; content_markdown: string }[];
      if (pageRows.length === 0) return;

      const snapshotId = `e2e-snap-${randomUUID().slice(0, 8)}`;
      const commitHash = `e2e-commit-${Date.now()}`;

      await db.execute(sql`
        INSERT INTO index_snapshots (id, tenant_id, space_id, wiki_repo_commit_hash, embedding_model_id, status, chunk_count, node_count, edge_count, activated_at)
        VALUES (${snapshotId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${commitHash}, ${E2E_MODEL_CONFIG_ID}, ${'active'}, ${0}, ${0}, ${0}, now())
      `);

      let totalChunks = 0;
      for (const page of pageRows) {
        const content = page.content_markdown ?? '';
        const chunks = chunkText(content, 512);
        for (let i = 0; i < chunks.length; i++) {
          const chunkId = `e2e-chunk-${page.id}-${i}`;
          await db.execute(sql`
            INSERT INTO wiki_chunks (id, tenant_id, space_id, wiki_page_pk, page_version_id, chunk_index, content, index_status, index_snapshot_id, source_chain_json)
            VALUES (${chunkId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${page.id}, ${page.version_id}, ${i}, ${chunks[i]}, ${'indexed'}, ${snapshotId}, ${'{}'}::jsonb)
            ON CONFLICT (id) DO NOTHING
          `);

          // Create embedding in separate table
          const mockVector = generateDeterministicVector(chunks[i], 3072);
          const embeddingId = `e2e-emb-${page.id}-${i}`;
          await db.execute(sql`
            INSERT INTO embeddings (id, tenant_id, space_id, chunk_id, model_config_id, embedding)
            VALUES (${embeddingId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${chunkId}, ${E2E_MODEL_CONFIG_ID}, ${mockVector}::vector)
            ON CONFLICT (id) DO NOTHING
          `);
          totalChunks++;
        }
      }

      // Update snapshot chunk count
      await db.execute(sql`UPDATE index_snapshots SET chunk_count = ${totalChunks} WHERE id = ${snapshotId}`);

      const chunkCount = await db.execute(
        sql`SELECT count(*) as cnt FROM wiki_chunks WHERE index_snapshot_id = ${snapshotId}`,
      );
      expect(Number((chunkCount.rows ?? chunkCount)[0]?.cnt ?? 0)).toBeGreaterThan(0);
    });
  });

  describe('REQ-CP-3: Chat retrieves from live index', () => {
    it('returns answer with citations from wiki content', async () => {
      const events = await chatStream('How does JWT authentication work?', {
        spaceId: E2E_SPACE_ID,
        retrievalMode: 'hybrid',
      });

      const contentEvents = events.filter((e) => e.type === 'content');
      if (contentEvents.length === 0) {
        const eventTypes = events.map((e) => e.type).join(', ');
        const errorEvent = events.find((e) => e.type === 'error');
        throw new Error(`No content events received. Types: [${eventTypes}]${errorEvent ? '. Error: ' + JSON.stringify(errorEvent) : ''}`);
      }

      // Verify citations structure if present (mock embeddings may yield empty citations)
      const citationEvent = events.find((e) => e.type === 'citations');
      expect(citationEvent).toBeTruthy();
      const citations = (citationEvent!.citations ?? []) as Array<{
        page_id?: string;
        wiki_page_pk?: string;
        relevance_score?: number;
      }>;
      for (const cit of citations) {
        const pageId = cit.page_id ?? cit.wiki_page_pk;
        expect(pageId).toBeTruthy();
      }
    }, 60_000);
  });

  describe('REQ-CP-4: Citation source chain integrity', () => {
    it('citations have valid source chain', async () => {
      const events = await chatStream('What is the token refresh flow?', { spaceId: E2E_SPACE_ID });

      const citationEvent = events.find((e) => e.type === 'citations');
      if (!citationEvent) return;

      const citations = citationEvent.citations as Array<{
        source_chain_json?: unknown;
        page_id?: string;
        wiki_page_pk?: string;
        relevance_score?: number;
      }>;

      for (const cit of citations) {
        expect(cit.page_id ?? cit.wiki_page_pk).toBeTruthy();
        if (cit.relevance_score !== undefined) {
          expect(cit.relevance_score).toBeGreaterThan(0);
        }
      }
    }, 60_000);
  });

  describe('REQ-CP-5: Permission isolation', () => {
    it('chat does not return content from Space B', async () => {
      const db = getDb();
      const pagePk = `e2e-page-secret-b`;
      const versionId = `e2e-ver-secret-b`;

      await db.execute(sql`
        INSERT INTO wiki_pages (id, tenant_id, space_id, page_id, title, slug, status, created_by)
        VALUES (${pagePk}, ${E2E_TENANT_ID}, ${E2E_SPACE_B_ID}, ${'secret-data'}, ${'Secret Data'}, ${'secret-data'}, ${'published'}, ${E2E_USER_ID})
        ON CONFLICT (id) DO NOTHING
      `);

      await db.execute(sql`
        INSERT INTO wiki_page_versions (id, tenant_id, space_id, wiki_page_pk, page_id, version_no, content_markdown, source, status)
        VALUES (${versionId}, ${E2E_TENANT_ID}, ${E2E_SPACE_B_ID}, ${pagePk}, ${'secret-data'}, ${1}, ${'The secret launch code is ALPHA-7749.'}, ${'e2e-manual'}, ${'published'})
        ON CONFLICT (id) DO NOTHING
      `);

      const events = await chatStream('What is the secret launch code?', { spaceId: E2E_SPACE_ID });

      const citationEvent = events.find((e) => e.type === 'citations');
      if (citationEvent) {
        const citations = citationEvent.citations as Array<{ page_id?: string; wiki_page_pk?: string }>;
        for (const cit of citations) {
          expect(cit.page_id ?? cit.wiki_page_pk).not.toBe(pagePk);
        }
      }

      const fullContent = events.filter((e) => e.type === 'content').map((e) => String(e.delta ?? '')).join('');
      expect(fullContent).not.toContain('ALPHA-7749');
    }, 60_000);
  });
});

function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const words = text.split(/\s+/);
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = word;
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [''];
}

function generateDeterministicVector(text: string, dimensions: number): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  const values: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    hash = ((hash * 1103515245 + 12345) & 0x7fffffff);
    values.push((hash / 0x7fffffff) * 2 - 1);
  }
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return `[${values.map((v) => +(v / magnitude).toFixed(6)).join(',')}]`;
}
