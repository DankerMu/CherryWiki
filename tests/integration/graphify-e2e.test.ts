import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

import { GraphImportService, MAX_NODES, parseGraphJson, validateGraphOutput, type ImportOperation } from '@cherrygraph/graph-core';
import { JobStatus, jobs } from '@cherrygraph/job-core';
import { graphifyRuns, wikiPages, wikiPageVersions } from '@cherrygraph/shared';
import { importGraphifyWiki, type NormalizationResult, type WikiPageImport } from '@cherrygraph/wiki-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../apps/api/src/audit/audit.service.js';
import { GraphifyService, type GraphifyContext, type GraphifyRunResponse } from '../../apps/api/src/graphify/graphify.service.js';
import { WikiService } from '../../apps/api/src/wiki/wiki.service.js';
import {
  UPLOAD_TEST_SPACE_ID,
  UPLOAD_TEST_TENANT_ID,
  UPLOAD_TEST_USER_ID,
  createAdminUploadContext,
  createUploadIntegrationContext,
  type UploadIntegrationContext,
} from './upload-integration-test-utils.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn(actual.randomUUID),
  };
});

type GraphifyRunRow = typeof graphifyRuns.$inferSelect;
type WikiPageRow = typeof wikiPages.$inferSelect;
type WikiPageVersionRow = typeof wikiPageVersions.$inferSelect;

type GraphifyIntegrationContext = UploadIntegrationContext & {
  graphify: GraphifyService;
  wiki: WikiService;
  graphImports: ImportOperation[];
  wikiPageRows: WikiPageRow[];
  wikiVersionRows: WikiPageVersionRow[];
  indexSnapshots: Array<{
    id: string;
    run_id: string;
    manifest: NormalizationResult['indexUpdateManifest'];
  }>;
};

const fixtureDir = new URL('../fixtures/test-graphify-output/', import.meta.url);
const wikiDir = new URL('wiki/', fixtureDir);
const fixtureGraphJsonUri = 's3://graphify-out/tenant-1/space-1/run/graph.json';
const fixtureWikiOutputUri = 's3://graphify-out/tenant-1/space-1/run/wiki/';
const fixtureReportUri = 's3://graphify-out/tenant-1/space-1/run/GRAPH_REPORT.md';

describe('graphify e2e integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P1-E1 full pipeline happy path creates a succeeded run and visible wiki pages', async () => {
    const context = createGraphifyIntegrationContext();
    seedParsedSourceDocuments(context, ['source-1', 'source-2']);

    const created = await createQueuedGraphifyRun(context, {
      runId: 'run-p1-e1',
      sourceDocumentIds: ['source-1', 'source-2'],
    });
    expect(created).toMatchObject({
      run_id: 'run-p1-e1',
      status: 'pending',
    });

    const pipeline = importFixtureOutput(context, created.run_id, ['source-1', 'source-2']);
    queueRunCompletion(context, created, pipeline.stats);

    const completed = await context.graphify.handleRunCompletion(created.run_id, {
      graph_json_uri: fixtureGraphJsonUri,
      wiki_output_uri: fixtureWikiOutputUri,
      report_uri: fixtureReportUri,
      schema_version: 'v1',
      stats_json: pipeline.stats,
    });

    expect(completed).toMatchObject({
      run_id: 'run-p1-e1',
      status: 'succeeded',
      result: {
        graph_json_uri: fixtureGraphJsonUri,
        report_uri: fixtureReportUri,
      },
    });
    expect(completed.result.nodes_created).toBeGreaterThan(0);
    expect(completed.result.edges_created).toBeGreaterThan(0);
    expect(completed.result.wiki_pages_generated).toBeGreaterThan(0);
    expect(context.graphImports).toHaveLength(1);
    expect(context.indexSnapshots).toHaveLength(1);

    queueWikiPageList(context);
    const pages = await context.wiki.listPages(UPLOAD_TEST_TENANT_ID, UPLOAD_TEST_SPACE_ID, {
      page: 1,
      per_page: 20,
    });

    expect(pages.pagination.total).toBeGreaterThan(0);
    expect(pages.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'graphify',
          title: expect.stringMatching(/Auth|Wiki Index/),
        }),
      ]),
    );
  });

  it('P1-E4 failure isolation leaves graph/wiki imports and previous success data unchanged', async () => {
    const context = createGraphifyIntegrationContext();
    seedParsedSourceDocuments(context, ['source-1', 'source-2']);

    const failed = await createQueuedGraphifyRun(context, {
      runId: 'run-first-failed',
      sourceDocumentIds: ['source-1'],
    });
    await context.graphify.handleRunFailure(failed.run_id, {
      error_json: { code: 'CLI_FAILURE', message: 'Graphify exited with status 1' },
    });

    expect(lastUpdateForTable(context, graphifyRuns)).toMatchObject({
      status: 'failed',
      error_json: { code: 'CLI_FAILURE', message: 'Graphify exited with status 1' },
      completed_at: expect.any(Date) as Date,
    });
    expect(importStats(context)).toEqual({
      nodes: 0,
      edges: 0,
      wikiPages: 0,
    });
    expect(context.indexSnapshots).toHaveLength(0);

    const succeeded = await createQueuedGraphifyRun(context, {
      runId: 'run-succeeded',
      sourceDocumentIds: ['source-1', 'source-2'],
    });
    const pipeline = importFixtureOutput(context, succeeded.run_id, ['source-1', 'source-2']);
    queueRunCompletion(context, succeeded, pipeline.stats);
    await context.graphify.handleRunCompletion(succeeded.run_id, {
      graph_json_uri: fixtureGraphJsonUri,
      wiki_output_uri: fixtureWikiOutputUri,
      report_uri: fixtureReportUri,
      stats_json: pipeline.stats,
    });

    const successfulStats = importStats(context);
    const successfulWikiPageIds = context.wikiPageRows.map((page) => page.page_id);
    const successfulSnapshotCount = context.indexSnapshots.length;

    const laterFailed = await createQueuedGraphifyRun(context, {
      runId: 'run-later-failed',
      sourceDocumentIds: ['source-1'],
    });
    await context.graphify.handleRunFailure(laterFailed.run_id, {
      error_json: { code: 'WORKER_FAILURE', message: 'worker crashed' },
    });

    expect(lastUpdateForTable(context, graphifyRuns)).toMatchObject({
      status: 'failed',
      error_json: { code: 'WORKER_FAILURE', message: 'worker crashed' },
    });
    expect(importStats(context)).toEqual(successfulStats);
    expect(context.wikiPageRows.map((page) => page.page_id)).toEqual(successfulWikiPageIds);
    expect(context.indexSnapshots).toHaveLength(successfulSnapshotCount);
  });

  it('P1-E9 cancel flow cancels the run and job without importing output', async () => {
    const context = createGraphifyIntegrationContext();
    seedParsedSourceDocuments(context, ['source-1']);

    const created = await createQueuedGraphifyRun(context, {
      runId: 'run-cancel',
      sourceDocumentIds: ['source-1'],
    });
    queueCancelRun(context, created);

    const result = await context.graphify.cancelRun(created.run_id, createAdminGraphifyContext());

    expect(result).toEqual({ run_id: 'run-cancel', status: 'cancelling' });
    expect(lastUpdateForTable(context, graphifyRuns)).toMatchObject({
      status: 'cancelled',
      completed_at: expect.any(Date) as Date,
    });
    expect(lastUpdateForTable(context, jobs)).toMatchObject({
      status: JobStatus.CANCELLED,
      cancel_requested_at: expect.any(Date) as Date,
      completed_at: expect.any(Date) as Date,
    });
    expect(importStats(context)).toEqual({
      nodes: 0,
      edges: 0,
      wikiPages: 0,
    });
    expect(context.indexSnapshots).toHaveLength(0);
  });

  it('P1-E10 batch merge creates one graphify job for five parsed files', async () => {
    const context = createGraphifyIntegrationContext();
    for (let index = 0; index < 5; index += 1) {
      context.sourceDocuments.seed({
        id: `source-${index + 1}`,
        filename: `source-${index + 1}.md`,
        status: 'parsed',
        parsed_uri: `s3://parsed/source-${index + 1}.md`,
        metadata_json: {
          batch_id: 'batch-1',
          processing_strategy: 'immediate',
        },
      });
    }

    for (const row of [...context.sourceDocuments.rows]) {
      await context.service.handleGraphifyHandoff(row.id, createAdminUploadContext());
    }

    const graphifyJobs = context.jobs.created.filter((job) => job.type === 'graphify');
    expect(graphifyJobs).toHaveLength(1);
    expect(graphifyJobs[0]?.payload_json).toMatchObject({
      batch_id: 'batch-1',
      source_document_ids: ['source-1', 'source-2', 'source-3', 'source-4', 'source-5'],
    });
    expect(context.jobs.rows.filter((job) => job.type === 'graphify')).toHaveLength(1);
    expect(context.sourceDocuments.rows.every((row) => row.status === 'graphify_pending')).toBe(true);
  });

  it('quarantines an oversized graph and skips import', async () => {
    const context = createGraphifyIntegrationContext();
    seedParsedSourceDocuments(context, ['source-1']);
    const created = await createQueuedGraphifyRun(context, {
      runId: 'run-quarantine',
      sourceDocumentIds: ['source-1'],
    });

    const oversizedValidation = validateGraphOutput({
      nodes: new Array(MAX_NODES + 1).fill({
        id: 'node',
        label: 'Node',
        norm_label: 'node',
        type: 'concept' as const,
      }),
      edges: [],
      hyperedges: [],
    });

    expect(oversizedValidation.valid).toBe(false);
    await context.graphify.handleRunFailure(created.run_id, {
      error_json: {
        reason: 'quarantined',
        code: 'GRAPH_VALIDATION_FAILED',
        details: {
          check: 'node_limit',
          actual_nodes: MAX_NODES + 1,
          max_nodes: MAX_NODES,
          errors: oversizedValidation.errors,
        },
      },
    });

    expect(lastUpdateForTable(context, graphifyRuns)).toMatchObject({
      status: 'failed',
      error_json: {
        reason: 'quarantined',
        details: {
          check: 'node_limit',
          actual_nodes: MAX_NODES + 1,
          max_nodes: MAX_NODES,
        },
      },
      completed_at: expect.any(Date) as Date,
    });
    expect(context.graphImports).toHaveLength(0);
    expect(context.wikiPageRows).toHaveLength(0);
    expect(context.indexSnapshots).toHaveLength(0);
  });
});

function createGraphifyIntegrationContext(): GraphifyIntegrationContext {
  const uploadContext = createUploadIntegrationContext();
  const audit = uploadContext.audit as unknown as AuditService;

  return {
    ...uploadContext,
    graphify: new GraphifyService(uploadContext.db.asDrizzle(), audit),
    wiki: new WikiService(uploadContext.db.asDrizzle(), audit),
    graphImports: [],
    wikiPageRows: [],
    wikiVersionRows: [],
    indexSnapshots: [],
  };
}

function createAdminGraphifyContext(overrides: Partial<GraphifyContext> = {}): GraphifyContext {
  return {
    tenantId: UPLOAD_TEST_TENANT_ID,
    actorUserId: UPLOAD_TEST_USER_ID,
    actorRole: 'admin',
    userId: UPLOAD_TEST_USER_ID,
    ...overrides,
  };
}

function seedParsedSourceDocuments(context: GraphifyIntegrationContext, sourceDocumentIds: string[]): void {
  for (const sourceDocumentId of sourceDocumentIds) {
    context.sourceDocuments.seed({
      id: sourceDocumentId,
      filename: `${sourceDocumentId}.md`,
      status: 'parsed',
      parsed_uri: `s3://parsed/${sourceDocumentId}.md`,
      metadata_json: {
        processing_strategy: 'immediate',
      },
    });
  }
}

async function createQueuedGraphifyRun(
  context: GraphifyIntegrationContext,
  input: { runId: string; sourceDocumentIds: string[] },
): Promise<GraphifyRunResponse> {
  const sourceDocuments = context.sourceDocuments.rows.filter((row) => input.sourceDocumentIds.includes(row.id));
  const jobId = `job-${context.jobs.rows.length + 1}`;
  const statsJson = {
    input_scope: { source_document_ids: input.sourceDocumentIds },
    options: { wiki: true },
    input_uri_count: sourceDocuments.filter((row) => typeof row.parsed_uri === 'string' && row.parsed_uri.length > 0).length,
  };

  context.queueSpaceExists();
  context.db.queueSelect([]);
  context.db.queueSelect(sourceDocuments.map((row) => ({ parsed_uri: row.parsed_uri })));
  context.db.queueInsert([
    createGraphifyRunRow({
      id: input.runId,
      job_id: null,
      status: 'pending',
      stats_json: statsJson,
    }),
  ]);
  context.db.queueUpdate([
    createGraphifyRunRow({
      id: input.runId,
      job_id: jobId,
      status: 'pending',
      stats_json: statsJson,
    }),
  ]);

  vi.mocked(crypto.randomUUID).mockReturnValueOnce(input.runId as ReturnType<typeof crypto.randomUUID>);

  const created = await context.graphify.createRun(
    UPLOAD_TEST_SPACE_ID,
    {
      mode: 'full',
      trigger_type: 'manual',
      input_scope: { source_document_ids: input.sourceDocumentIds },
      options: { wiki: true },
    },
    createAdminGraphifyContext(),
  );

  expect(created.run_id).toBe(input.runId);
  const graphifyJob = context.jobs.rows.filter((job) => job.type === 'graphify').at(-1);
  expect(readRecord(graphifyJob?.payload_json).run_id).toBe(created.run_id);

  return created;
}

function queueRunCompletion(
  context: GraphifyIntegrationContext,
  run: GraphifyRunResponse,
  stats: Record<string, unknown>,
): void {
  const activeRun = createGraphifyRunRow({
    id: run.run_id,
    job_id: context.jobs.rows.at(-1)?.id ?? 'job-1',
    status: 'pending',
    stats_json: {
      input_scope: { source_document_ids: run.input_scope.source_document_ids },
      options: { wiki: true },
      input_uri_count: run.input_scope.source_document_ids.length,
    },
  });
  context.db.queueSelect([activeRun]);
  context.db.queueUpdate([
    createGraphifyRunRow({
      ...activeRun,
      status: 'succeeded',
      graph_json_uri: fixtureGraphJsonUri,
      wiki_output_uri: fixtureWikiOutputUri,
      report_uri: fixtureReportUri,
      schema_version: 'v1',
      stats_json: {
        ...readRecord(activeRun.stats_json),
        ...stats,
      },
      error_json: null,
      completed_at: new Date('2026-05-02T12:10:00.000Z'),
    }),
  ]);
}

function queueCancelRun(context: GraphifyIntegrationContext, run: GraphifyRunResponse): void {
  const job = context.jobs.rows.at(-1);
  if (job === undefined) {
    throw new Error('Expected graphify job to exist before cancelling run');
  }

  const activeRun = createGraphifyRunRow({
    id: run.run_id,
    job_id: job.id,
    status: 'pending',
    stats_json: {
      input_scope: { source_document_ids: run.input_scope.source_document_ids },
    },
  });
  const cancelledAt = new Date('2026-05-02T12:20:00.000Z');

  context.db.queueSelect([activeRun]);
  context.queueSpaceExists();
  context.db.queueUpdate([
    createGraphifyRunRow({
      ...activeRun,
      status: 'cancelled',
      completed_at: cancelledAt,
    }),
  ]);
  context.db.queueSelect([job]);
  context.db.queueUpdate([
    {
      ...job,
      status: JobStatus.CANCELLED,
      cancel_requested_at: cancelledAt,
      completed_at: cancelledAt,
    },
  ]);
}

function importFixtureOutput(
  context: GraphifyIntegrationContext,
  runId: string,
  sourceDocumentIds: string[],
): { stats: Record<string, unknown>; normalization: NormalizationResult } {
  const rawGraph = readFileSync(new URL('graph.json', fixtureDir), 'utf8');
  const parsed = parseGraphJson(rawGraph);
  const validation = validateGraphOutput(parsed);
  expect(validation.valid).toBe(true);
  expect(validation.errors).toEqual([]);

  const operation = new GraphImportService().importRun(
    UPLOAD_TEST_TENANT_ID,
    UPLOAD_TEST_SPACE_ID,
    runId,
    validation,
  );
  context.graphImports.push(operation);

  const normalization = importGraphifyWiki({
    tenantId: UPLOAD_TEST_TENANT_ID,
    spaceId: UPLOAD_TEST_SPACE_ID,
    spaceSlug: UPLOAD_TEST_SPACE_ID,
    runId,
    communityLabels: ['Auth System', 'Permission System'],
    godNodeLabels: ['JWT Authentication', 'RBAC Permission Model'],
    stableKeys: new Map([
      ['JWT Authentication', 'jwtstablekeyabcdef'],
      ['RBAC Permission Model', 'rbacstablekeyabcdef'],
    ]),
    wikiFiles: readFixtureWikiFiles(),
    reportMarkdown: readFileSync(new URL('GRAPH_REPORT.md', fixtureDir), 'utf8'),
    existingPages: new Map(),
    existingBlockMetadata: new Map(),
    sourceDocumentIds,
    now: '2026-05-02T12:00:00.000Z',
  });
  persistWikiImport(context, runId, normalization);

  return {
    normalization,
    stats: {
      nodes_created: operation.stats.nodesCreated,
      edges_created: operation.stats.edgesCreated,
      wiki_pages_generated: normalization.pagesCreated.length + normalization.pagesUpdated.length,
      node_count: validation.validNodes.length,
      edge_count: validation.validEdges.length,
      community_count: operation.stats.communitiesCreated,
    },
  };
}

function readFixtureWikiFiles(): Map<string, string> {
  return new Map([
    ['index.md', readFileSync(new URL('index.md', wikiDir), 'utf8')],
    ['auth-system.md', readFileSync(new URL('auth-system.md', wikiDir), 'utf8')],
    ['permission-system.md', readFileSync(new URL('permission-system.md', wikiDir), 'utf8')],
    ['jwt-authentication.md', readFileSync(new URL('jwt-authentication.md', wikiDir), 'utf8')],
    ['rbac-permission-model.md', readFileSync(new URL('rbac-permission-model.md', wikiDir), 'utf8')],
  ]);
}

function persistWikiImport(
  context: GraphifyIntegrationContext,
  runId: string,
  normalization: NormalizationResult,
): void {
  const importedPages = [...normalization.pagesCreated, ...normalization.pagesUpdated];
  for (const page of importedPages) {
    persistWikiPage(context, runId, page);
  }

  context.indexSnapshots.push({
    id: `index-snapshot-${context.indexSnapshots.length + 1}`,
    run_id: runId,
    manifest: normalization.indexUpdateManifest,
  });
}

function persistWikiPage(context: GraphifyIntegrationContext, runId: string, page: WikiPageImport): void {
  const pagePk = `wiki-page-pk-${context.wikiPageRows.length + 1}`;
  const versionId = `wiki-version-${context.wikiVersionRows.length + 1}`;
  const pageRow = createWikiPageRow({
    id: pagePk,
    page_id: page.pageId,
    title: page.title,
    slug: page.slug,
    status: readString(page.frontmatter.status, 'draft'),
    current_version_id: versionId,
    indexed_version_id: versionId,
  });
  const versionRow = createWikiPageVersionRow({
    id: versionId,
    wiki_page_pk: pagePk,
    page_id: page.pageId,
    version_no: page.versionNo,
    content_markdown: page.contentMarkdown,
    frontmatter_json: {
      ...page.frontmatter,
      blocks: page.blockMetadata.map((block) => ({
        block_id: block.blockId,
        owner: block.owner,
        editable: block.editable,
      })),
    },
    source: page.source,
    graphify_run_id: runId,
  });

  context.wikiPageRows.push(pageRow);
  context.wikiVersionRows.push(versionRow);
}

function queueWikiPageList(context: GraphifyIntegrationContext): void {
  context.db.queueSelect(
    context.wikiPageRows.map((page) => {
      const version = context.wikiVersionRows.find((candidate) => candidate.id === page.current_version_id);
      return {
        page,
        currentVersion: {
          source: version?.source ?? 'graphify',
          frontmatter_json: version?.frontmatter_json ?? {},
        },
      };
    }),
  );
  context.db.queueSelect([{ total: context.wikiPageRows.length }]);
}

function importStats(context: GraphifyIntegrationContext): { nodes: number; edges: number; wikiPages: number } {
  return {
    nodes: context.graphImports.reduce((total, operation) => total + operation.nodes.length, 0),
    edges: context.graphImports.reduce((total, operation) => total + operation.edges.length, 0),
    wikiPages: context.wikiPageRows.length,
  };
}

function lastUpdateForTable(context: GraphifyIntegrationContext, table: unknown): Record<string, unknown> {
  const update = [...context.db.updates].reverse().find((item) => item.table === table);
  if (update === undefined || !isRecord(update.value)) {
    throw new Error('Expected update record for table');
  }

  return update.value;
}

function createGraphifyRunRow(overrides: Partial<GraphifyRunRow> = {}): GraphifyRunRow {
  return {
    id: 'run-1',
    tenant_id: UPLOAD_TEST_TENANT_ID,
    space_id: UPLOAD_TEST_SPACE_ID,
    job_id: 'job-1',
    trigger_type: 'manual',
    mode: 'full',
    status: 'pending',
    input_version: null,
    output_version: null,
    graphify_ref: null,
    graph_json_uri: null,
    wiki_output_uri: null,
    report_uri: null,
    graph_html_uri: null,
    schema_version: 'v1',
    stats_json: {},
    error_json: null,
    created_by: UPLOAD_TEST_USER_ID,
    created_at: new Date('2026-05-02T12:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function createWikiPageRow(overrides: Partial<WikiPageRow> = {}): WikiPageRow {
  return {
    id: 'wiki-page-pk-1',
    tenant_id: UPLOAD_TEST_TENANT_ID,
    space_id: UPLOAD_TEST_SPACE_ID,
    page_id: 'page-1',
    title: 'Wiki Index',
    slug: 'index',
    status: 'draft',
    current_version_id: 'wiki-version-1',
    indexed_version_id: 'wiki-version-1',
    sync_status: 'synced',
    docmost_page_id: null,
    created_by: UPLOAD_TEST_USER_ID,
    created_at: new Date('2026-05-02T12:00:00.000Z'),
    updated_at: new Date('2026-05-02T12:00:00.000Z'),
    ...overrides,
  };
}

function createWikiPageVersionRow(overrides: Partial<WikiPageVersionRow> = {}): WikiPageVersionRow {
  return {
    id: 'wiki-version-1',
    tenant_id: UPLOAD_TEST_TENANT_ID,
    space_id: UPLOAD_TEST_SPACE_ID,
    wiki_page_pk: 'wiki-page-pk-1',
    page_id: 'page-1',
    version_no: 1,
    content_markdown: '# Wiki Index',
    frontmatter_json: {},
    source: 'graphify',
    graphify_run_id: 'run-1',
    commit_hash: null,
    status: 'draft',
    created_by: UPLOAD_TEST_USER_ID,
    created_at: new Date('2026-05-02T12:00:00.000Z'),
    ...overrides,
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
