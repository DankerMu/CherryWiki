import {
  QUEUE_INDEXING,
  type JobRow,
} from '@cherrygraph/job-core';
import { graphEdges, wikiPages } from '@cherrygraph/shared';
import { vi } from 'vitest';

import type { FeedbackService } from '../../apps/api/src/feedback/feedback.service.js';
import { GovernanceService } from '../../apps/api/src/governance/governance.service.js';
import {
  ScriptedDb,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  createAuditMock,
} from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';

export {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
};

export function createGovernanceServiceContext(options: {
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

export function createGovernanceContext(): {
  tenantId: string;
  actorUserId: string;
} {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
  };
}

export function createEdgeRow(overrides: Partial<typeof graphEdges.$inferSelect> = {}): typeof graphEdges.$inferSelect {
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

export function createPageRow(overrides: Partial<typeof wikiPages.$inferSelect> = {}): typeof wikiPages.$inferSelect {
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

export function createConflictEdgeRow(overrides: Partial<{
  edge_id: string;
  space_id: string;
  source_node_id: string;
  target_node_id: string;
  source_label: string;
  target_label: string;
  relation_type: string;
  confidence_label: string;
  effective_confidence_score: number;
}> = {}): {
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
    edge_id: 'edge-1',
    space_id: TEST_SPACE_ID,
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    source_label: 'Service A',
    target_label: 'Service B',
    relation_type: 'depends_on',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.9,
    ...overrides,
  };
}

export function createQueueMock(): {
  add: ReturnType<typeof vi.fn<(name: string, data: { jobId: string }) => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  return {
    add: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

export function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
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
