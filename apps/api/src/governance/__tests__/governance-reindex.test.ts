import {
  JobRepository,
  QueueFactory,
  QUEUE_INDEXING,
  type JobRow,
} from '@cherrygraph/job-core';
import { graphEdges, wikiPages } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FeedbackService } from '../../feedback/feedback.service.js';
import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { GovernanceService } from '../governance.service.js';

describe('governance reindex triggers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an indexer job after edge review', async () => {
    const { service, db } = createServiceContext();
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(createJobRow({ id: 'job-edge' }));
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(createQueueMock() as never);
    db.queueSelect([createEdgeRow()]);
    db.queueUpdate([createEdgeRow({ effective_confidence_score: 0.88, confidence_label: 'EXTRACTED' })]);

    await service.reviewEdge(
      'edge-1',
      { action: 'confirm', effective_score: 0.88, reason: 'Verified' },
      createContext(),
    );

    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: expect.objectContaining({
          trigger: 'governance_action',
          scope: 'full',
          governance_action: 'edge_review',
        }) as unknown,
      }),
    );
  });

  it('creates an indexer job after page merge', async () => {
    const { service, db } = createServiceContext();
    const createJobSpy = vi.spyOn(JobRepository, 'create').mockResolvedValue(createJobRow({ id: 'job-merge' }));
    vi.spyOn(QueueFactory, 'createQueue').mockReturnValue(createQueueMock() as never);
    db.queueSelect([createPageRow({ id: 'from-pk', page_id: 'from-page' })]);
    db.queueSelect([createPageRow({ id: 'to-pk', page_id: 'to-page' })]);
    db.queueSelect([{ stable_key: 'stable-from' }]);
    db.queueSelect([{ stable_key: 'stable-to' }]);
    db.queueUpdate([createPageRow({ id: 'from-pk', page_id: 'from-page', status: 'merged' })]);

    await service.mergePages(
      { from_page_id: 'from-page', to_page_id: 'to-page', reason: 'Duplicate' },
      createContext(),
    );

    expect(createJobSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        queue_name: QUEUE_INDEXING,
        type: 'reindex',
        payload_json: expect.objectContaining({
          trigger: 'governance_action',
          scope: 'full',
          governance_action: 'page_merge',
          from_page_id: 'from-page',
          to_page_id: 'to-page',
        }) as unknown,
      }),
    );
  });
});

function createServiceContext(): {
  service: GovernanceService;
  db: ScriptedDb;
} {
  const db = new ScriptedDb();
  const audit = createAuditMock();
  const feedbackService = { createConflictFeedback: vi.fn() } as unknown as FeedbackService;
  const service = new GovernanceService(db.asDrizzle(), audit.service, feedbackService, {} as never);
  return { service, db };
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
