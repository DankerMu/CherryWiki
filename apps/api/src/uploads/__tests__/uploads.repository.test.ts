import { describe, expect, it } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  requireRecord,
} from '../../users/__tests__/user-group-service-test-utils.js';
import {
  FileBlobRepository,
  SourceDocumentConflictError,
  SourceDocumentRepository,
  type FileBlobRow,
  type SourceDocumentRow,
} from '../uploads.repository.js';

describe('Upload repositories', () => {
  it('creates and finds file blobs by tenant and sha256', async () => {
    const db = new ScriptedDb();
    const repository = new FileBlobRepository(db.asDrizzle());
    const created = createFileBlobRow({ id: 'blob-created' });
    db.queueInsert([created]);
    db.queueSelect([created]);

    await expect(
      repository.create({
        tenant_id: TEST_TENANT_ID,
        sha256: created.sha256,
        size_bytes: 1024,
        mime_type: 'application/pdf',
        storage_uri: 's3://archives/file.pdf',
      }),
    ).resolves.toEqual(created);
    await expect(repository.findByTenantAndSha256(TEST_TENANT_ID, created.sha256)).resolves.toEqual(created);

    expect(requireRecord(db.inserts[0]?.value)).toMatchObject({
      tenant_id: TEST_TENANT_ID,
      sha256: created.sha256,
      storage_uri: 's3://archives/file.pdf',
    });
  });

  it('creates source documents and finds same-space blob references', async () => {
    const db = new ScriptedDb();
    const repository = new SourceDocumentRepository(db.asDrizzle());
    const created = createSourceDocumentRow({ id: 'source-created' });
    db.queueInsert([created]);
    db.queueSelect([created]);

    await expect(
      repository.create({
        tenant_id: TEST_TENANT_ID,
        space_id: TEST_SPACE_ID,
        file_blob_id: 'blob-1',
        filename: 'report.pdf',
        uploader_id: TEST_USER_ID,
        source_type: 'upload',
        status: 'uploaded',
        metadata_json: { batch_id: 'batch-1' },
      }),
    ).resolves.toEqual(created);
    await expect(repository.findBySpaceAndBlob(TEST_TENANT_ID, TEST_SPACE_ID, 'blob-1')).resolves.toEqual(created);
  });

  it('enforces legal source document status transitions', async () => {
    const db = new ScriptedDb();
    const repository = new SourceDocumentRepository(db.asDrizzle());
    const archived = createSourceDocumentRow({ status: 'archived' });
    db.queueSelect([createSourceDocumentRow({ status: 'validating' })]);
    db.queueUpdate([archived]);

    await expect(repository.updateStatus('source-1', 'archived')).resolves.toEqual(archived);
    expect(requireRecord(db.updates[0]?.value)).toMatchObject({
      status: 'archived',
    });
  });

  it('rejects illegal source document status transitions', async () => {
    const db = new ScriptedDb();
    const repository = new SourceDocumentRepository(db.asDrizzle());
    db.queueSelect([createSourceDocumentRow({ status: 'uploaded' })]);

    await expect(repository.updateStatus('source-1', 'parsing')).rejects.toBeInstanceOf(
      SourceDocumentConflictError,
    );
    expect(db.updates).toHaveLength(0);
  });

  it('returns filtered source documents with pagination metadata', async () => {
    const db = new ScriptedDb();
    const repository = new SourceDocumentRepository(db.asDrizzle());
    const rows = [
      createSourceDocumentRow({ id: 'source-1' }),
      createSourceDocumentRow({ id: 'source-2', filename: 'notes.md' }),
    ];
    db.queueSelect(rows);
    db.queueSelect([{ total: 5 }]);

    const result = await repository.findByFilter({
      tenant_id: TEST_TENANT_ID,
      space_id: TEST_SPACE_ID,
      page: 2,
      perPage: 2,
      sort: '-created_at',
    });

    expect(result.data).toEqual(rows);
    expect(result.pagination).toEqual({
      page: 2,
      per_page: 2,
      total: 5,
      has_next: true,
    });
    expect(db.limitCalls).toContain(2);
    expect(db.offsetCalls).toEqual([2]);
  });
});

export function createFileBlobRow(overrides: Partial<FileBlobRow> = {}): FileBlobRow {
  return {
    id: 'blob-1',
    tenant_id: TEST_TENANT_ID,
    sha256: 'a'.repeat(64),
    size_bytes: 1024,
    mime_type: 'application/pdf',
    storage_uri: 's3://archives/archive/report.pdf',
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    ...overrides,
  };
}

export function createSourceDocumentRow(overrides: Partial<SourceDocumentRow> = {}): SourceDocumentRow {
  return {
    id: 'source-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    file_blob_id: 'blob-1',
    filename: 'report.pdf',
    uploader_id: TEST_USER_ID,
    source_type: 'upload',
    classification: null,
    status: 'uploaded',
    parsed_uri: null,
    metadata_json: {},
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    updated_at: new Date('2026-04-30T00:00:00.000Z'),
    ...overrides,
  };
}
