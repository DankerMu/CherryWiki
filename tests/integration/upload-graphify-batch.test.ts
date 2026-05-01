import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAdminUploadContext,
  createUploadIntegrationContext,
} from './upload-integration-test-utils.js';

describe('upload graphify batch integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates one graphify run for a parsed immediate batch and leaves stash documents untouched', async () => {
    const context = createUploadIntegrationContext();
    for (let index = 0; index < 5; index += 1) {
      context.sourceDocuments.seed({
        id: `source-${index + 1}`,
        status: 'parsed',
        metadata_json: {
          batch_id: 'batch-1',
          processing_strategy: 'immediate',
        },
      });
    }
    context.sourceDocuments.seed({
      id: 'source-stash',
      status: 'parsed',
      metadata_json: {
        batch_id: 'batch-stash',
        processing_strategy: 'stash',
      },
    });

    for (const row of context.sourceDocuments.rows.filter((item) => item.id !== 'source-stash')) {
      await context.service.handleGraphifyHandoff(row.id, createAdminUploadContext());
    }
    await expect(context.service.handleGraphifyHandoff('source-stash', createAdminUploadContext())).resolves.toBeNull();

    const graphifyJobs = context.jobs.created.filter((job) => job.type === 'graphify');
    expect(graphifyJobs).toHaveLength(1);
    expect(graphifyJobs[0]?.payload_json).toMatchObject({
      batch_id: 'batch-1',
      source_document_ids: ['source-1', 'source-2', 'source-3', 'source-4', 'source-5'],
    });
    expect(
      context.sourceDocuments.rows
        .filter((row) => row.id !== 'source-stash')
        .every((row) => row.status === 'graphify_pending'),
    ).toBe(true);
    expect(context.sourceDocuments.rows.find((row) => row.id === 'source-stash')?.status).toBe('parsed');
  });
});
