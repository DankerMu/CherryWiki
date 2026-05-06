import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  type JobRow,
} from '@cherrygraph/job-core';
import { ErrorCode, graphEdges, graphNodeMerges, wikiPages } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../../audit/audit.service.js';
import type { FeedbackService } from '../../feedback/feedback.service.js';
import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { GovernanceService } from '../governance.service.js';

describe('GovernanceService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists low-confidence edges with node labels and pagination metadata', async () => {
    const { service, db } = createServiceContext();
    db.queueExecute({
      rows: [
        {
          edge_id: 'edge-1',
          source_node_id: 'node-a',
          source_node_label: 'Service A',
          target_node_id: 'node-b',
          target_node_label: 'Service B',
          relation_type: 'depends_on',
          effective_confidence_score: '0.42',
          raw_confidence_score: '0.61',
          confidence_label: 'AMBIGUOUS',
          evidence_count: '2',
          space_id: TEST_SPACE_ID,
        },
      ],
    });

    const result = await service.listLowConfidenceEdges({ threshold: 0.7, limit: 10 }, createContext());

    expect(result).toMatchObject({
      limit: 10,
      offset: 0,
      has_next: false,
      items: [
        {
          edge_id: 'edge-1',
          source_node: { id: 'node-a', label: 'Service A' },
          target_node: { id: 'node-b', label: 'Service B' },
          effective_confidence_score: 0.42,
          raw_confidence_score: 0.61,
          evidence_count: 2,
        },
      ],
    });
  });

  it('confirms an edge, preserves raw confidence, audits before/after values, and creates a reindex job', async () => {
    const { service, db, audit } = createServiceContext({ redis: {} as never });
    const queue = createQueueMock();
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(queue as never);
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(createJobRow({ id: 'job-review' }));
    const existing = createEdgeRow({
      effective_confidence_score: 0.41,
      raw_confidence_score: 0.62,
      confidence_label: 'AMBIGUOUS',
    });
    const updated = createEdgeRow({
      effective_confidence_score: 0.9,
      raw_confidence_score: 0.62,
      confidence_label: 'EXTRACTED',
    });
    db.queueSelect([existing]);
    db.queueUpdate([updated]);

    const result = await service.reviewEdge(
      'edge-1',
      { action: 'confirm', effective_score: 0.9, reason: 'Manual verification' },
      createContext(),
    );

    expect(db.updates[0]?.value).toMatchObject({
      effective_confidence_score: 0.9,
      confidence_label: 'EXTRACTED',
    });
    expect(result).toMatchObject({
      edge_id: 'edge-1',
      effective_confidence_score: 0.9,
      raw_confidence_score: 0.62,
      confidence_label: 'EXTRACTED',
      reindex_job_id: 'job-review',
    });
    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant_id: TEST_TENANT_ID,
        space_id: TEST_SPACE_ID,
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: expect.objectContaining({
          trigger: 'governance_action',
          governance_action: 'edge_review',
          edge_id: 'edge-1',
        }) as unknown,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('reindex', { jobId: 'job-review' });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'governance.edge.reviewed',
        metadata_json: expect.objectContaining({
          before: { effective_confidence_score: 0.41, confidence_label: 'AMBIGUOUS' },
          after: { effective_confidence_score: 0.9, confidence_label: 'EXTRACTED' },
          raw_confidence_score: 0.62,
        }) as unknown,
      }) as AuditEntry,
    );
  });

  it('rejects and re-reviews rejected edges without changing raw confidence', async () => {
    const { service, db } = createServiceContext({ redis: {} as never });
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(createQueueMock() as never);
    vi.spyOn(JobRepository, 'create')
      .mockResolvedValueOnce(createJobRow({ id: 'job-reject' }))
      .mockResolvedValueOnce(createJobRow({ id: 'job-rereview' }));
    db.queueSelect([createEdgeRow({ raw_confidence_score: 0.72 })]);
    db.queueUpdate([createEdgeRow({ effective_confidence_score: 0, confidence_label: 'REJECTED', raw_confidence_score: 0.72 })]);
    db.queueSelect([createEdgeRow({ effective_confidence_score: 0, confidence_label: 'REJECTED', raw_confidence_score: 0.72 })]);
    db.queueUpdate([createEdgeRow({ effective_confidence_score: 0.7, confidence_label: 'INFERRED', raw_confidence_score: 0.72 })]);

    const rejected = await service.reviewEdge('edge-1', { action: 'reject', reason: 'Hallucinated' }, createContext());
    const restored = await service.reviewEdge(
      'edge-1',
      { action: 'confirm', effective_score: 0.7, reason: 'Restored' },
      createContext(),
    );

    expect(rejected).toMatchObject({ effective_confidence_score: 0, confidence_label: 'REJECTED', raw_confidence_score: 0.72 });
    expect(restored).toMatchObject({ effective_confidence_score: 0.7, confidence_label: 'INFERRED', raw_confidence_score: 0.72 });
  });

  it('returns INVALID_CONFIDENCE_SCORE for confirm scores below the review threshold', async () => {
    const { service } = createServiceContext();

    const err = await getRejectedHttpException(
      service.reviewEdge(
        'edge-1',
        { action: 'confirm', effective_score: 0.3, reason: 'Too low' },
        createContext(),
      ),
    );

    expect(err.getStatus()).toBe(400);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.INVALID_CONFIDENCE_SCORE);
  });

  it('lists duplicate page suggestions from trigram query rows', async () => {
    const { service, db } = createServiceContext();
    db.queueExecute({
      rows: [
        {
          page_a_id: 'page-a',
          page_b_id: 'page-b',
          page_a_title: 'React Setup',
          page_b_title: 'ReactJS Setup',
          similarity_score: '0.92',
          suggested_target: 'page-a',
        },
      ],
    });

    const result = await service.listDuplicateSuggestions({ space_id: TEST_SPACE_ID }, createContext());

    expect(result.items).toEqual([
      {
        page_a_id: 'page-a',
        page_b_id: 'page-b',
        page_a_title: 'React Setup',
        page_b_title: 'ReactJS Setup',
        similarity_score: 0.92,
        suggested_target: 'page-a',
      },
    ]);
  });

  it('merges pages by inserting graph_node_merges, marking the source as merged, auditing, and reindexing', async () => {
    const { service, db, audit } = createServiceContext({ redis: {} as never });
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(createQueueMock() as never);
    vi.spyOn(JobRepository, 'create').mockResolvedValue(createJobRow({ id: 'job-merge' }));
    db.queueSelect([createPageRow({ id: 'from-pk', page_id: 'from-page' })]);
    db.queueSelect([createPageRow({ id: 'to-pk', page_id: 'to-page' })]);
    db.queueSelect([{ stable_key: 'stable-from' }]);
    db.queueSelect([{ stable_key: 'stable-to' }]);
    db.queueUpdate([createPageRow({ id: 'from-pk', page_id: 'from-page', status: 'merged', sync_status: 'redirect:to-page' })]);

    const result = await service.mergePages(
      { from_page_id: 'from-page', to_page_id: 'to-page', reason: 'Duplicate page' },
      createContext(),
    );

    expect(db.inserts[0]?.table).toBe(graphNodeMerges);
    expect(db.inserts[0]?.value).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      from_stable_key: 'stable-from',
      to_stable_key: 'stable-to',
      reason: 'Duplicate page',
      created_by: TEST_USER_ID,
    });
    expect(db.updates[0]?.table).toBe(wikiPages);
    expect(db.updates[0]?.value).toMatchObject({
      status: 'merged',
      sync_status: 'redirect:to-page',
    });
    expect(result).toMatchObject({
      from_page_id: 'from-page',
      to_page_id: 'to-page',
      status: 'merged',
      sync_status: 'redirect:to-page',
      reindex_job_id: 'job-merge',
    });
    expect(audit.push).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'governance.page.merged',
        metadata_json: expect.objectContaining({
          from_page_id: 'from-page',
          to_page_id: 'to-page',
          reason: 'Duplicate page',
        }) as unknown,
      }) as AuditEntry,
    );
  });

  it('persists detected conflicts as conflict feedback items', async () => {
    const createConflictFeedback = vi.fn<FeedbackService['createConflictFeedback']>(() =>
      Promise.resolve({ id: 'feedback-conflict' } as never),
    );
    const { service, db } = createServiceContext({
      feedbackService: { createConflictFeedback } as unknown as FeedbackService,
    });
    db.queueSelect([]);
    db.queueExecute({
      rows: [
        createConflictEdgeRow({ edge_id: 'edge-a', relation_type: 'depends_on', confidence_label: 'EXTRACTED' }),
        createConflictEdgeRow({ edge_id: 'edge-b', relation_type: 'independent_of', confidence_label: 'EXTRACTED' }),
      ],
    });
    db.queueExecute({ rows: [] });

    const result = await service.detectAndPersistConflicts({}, createContext());

    expect(result).toHaveLength(1);
    expect(createConflictFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        conflict_type: 'contradictory_edges',
        severity: 'high',
        fingerprint: expect.stringContaining('contradictory_edges') as unknown,
      }),
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        actorUserId: TEST_USER_ID,
        spaceId: TEST_SPACE_ID,
      }),
    );
  });
});

function createServiceContext(options: {
  redis?: never;
  feedbackService?: FeedbackService;
} = {}): {
  service: GovernanceService;
  db: ScriptedDb;
  audit: ReturnType<typeof createAuditMock>;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const feedbackService = options.feedbackService ?? ({
    createConflictFeedback: vi.fn(() => Promise.resolve({ id: 'feedback-conflict' })),
  } as unknown as FeedbackService);
  const service = new GovernanceService(db.asDrizzle(), audit.service, feedbackService, options.redis);
  return { service, db, audit };
}

function createContext(): {
  tenantId: string;
  actorUserId: string;
} {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
  };
}

function createEdgeRow(overrides: Partial<typeof graphEdges.$inferSelect> = {}): typeof graphEdges.$inferSelect {
  return {
    id: 'edge-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    graphify_run_id: 'run-1',
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    relation_type: 'depends_on',
    confidence_label: 'AMBIGUOUS',
    raw_confidence_score: 0.6,
    effective_confidence_score: 0.4,
    evidence_count: 1,
    evidence_refs_json: [],
    acl_json: {},
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createPageRow(overrides: Partial<typeof wikiPages.$inferSelect> = {}): typeof wikiPages.$inferSelect {
  return {
    id: 'wiki-pk-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    page_id: 'page-1',
    title: 'Page 1',
    slug: 'page-1',
    status: 'published',
    current_version_id: null,
    indexed_version_id: null,
    sync_status: 'synced',
    docmost_page_id: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    updated_at: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createConflictEdgeRow(overrides: Partial<ReturnType<typeof createConflictEdgeRowBase>> = {}): ReturnType<typeof createConflictEdgeRowBase> {
  return {
    ...createConflictEdgeRowBase(),
    ...overrides,
  };
}

function createConflictEdgeRowBase(): {
  edge_id: string;
  space_id: string;
  source_node_id: string;
  target_node_id: string;
  source_label: string;
  target_label: string;
  relation_type: string;
  confidence_label: string;
  effective_confidence_score: number;
} {
  return {
    edge_id: 'edge-a',
    space_id: TEST_SPACE_ID,
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    source_label: 'Service A',
    target_label: 'Service B',
    relation_type: 'depends_on',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.9,
  };
}

function createQueueMock(): {
  add: ReturnType<typeof vi.fn<(name: string, data: { jobId: string }) => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    add: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    queue_name: QUEUE_INDEXING,
    type: 'reindex',
    priority: 100,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    timeout_seconds: null,
    locked_by: null,
    locked_at: null,
    next_run_at: null,
    cancel_requested_at: null,
    payload_json: {},
    result_json: null,
    error_json: null,
    idempotency_key: null,
    created_by: TEST_USER_ID,
    created_at: new Date('2026-05-01T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}
