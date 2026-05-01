import { JobRepository, type JobCreateInput, type JobRow } from '@cherrygraph/job-core';
import type { SourceDocumentStatus } from '@cherrygraph/shared';
import { ErrorCode } from '@cherrygraph/shared';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  ScriptedDb,
  createUniqueViolation,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { ArchivePathHelper, type StorageService } from '../../storage/storage.service.js';
import { SourceDocumentStateMachine } from '../source-document-state.js';
import {
  FileBlobRepository,
  SourceDocumentRepository,
  type FileBlobRow,
  type SourceDocumentRow,
} from '../uploads.repository.js';
import { UPLOAD_MAX_BYTES } from '../uploads.constants.js';
import { UploadsService, type UploadContext } from '../uploads.service.js';
import { MimeValidator } from '../validators/mime-validator.js';
import { PromptInjectionScanner } from '../validators/prompt-injection-scanner.js';
import { ValidationPipeline, type RecordedValidationPipelineResult } from '../validators/validation-pipeline.js';
import { ZipValidator } from '../validators/zip-validator.js';

describe('UploadsService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('archives small files immediately and creates a high-priority ingestion job', async () => {
    const { service, db, storage, fileBlobs, sourceDocuments, jobs } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const result = await service.uploadFile(
      {
        spaceId: TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('hello'), { originalname: 'report.pdf', mimetype: 'application/pdf' }),
        metadata: { tags: '["auth"]', processing_strategy: 'immediate' },
      },
      createAdminContext(),
    );

    expect(result).toMatchObject({
      file_blob_id: expect.any(String) as string,
      job_id: 'job-1',
      status: 'archived',
      created: true,
    });
    expect(storage.uploadToQuarantine).toHaveBeenCalledTimes(1);
    expect(storage.promoteToArchive).toHaveBeenCalledTimes(1);
    expect(fileBlobs.rows[0]?.storage_uri).toContain('archive/');
    expect(sourceDocuments.rows[0]?.status).toBe('archived');
    expect(sourceDocuments.rows[0]?.metadata_json).toMatchObject({
      tags: ['auth'],
      processing_strategy: 'immediate',
      archive_key: expect.stringContaining('archive/') as string,
    });
    expect(jobs.created[0]).toMatchObject({
      queue_name: 'ingestion',
      type: 'ingestion',
      priority: 50,
    });
  });

  it('returns an existing same-space source document without storing or queueing work', async () => {
    const { service, db, storage, fileBlobs, sourceDocuments, jobs } = createServiceContext();
    const blob = fileBlobs.seed(createFileBlobRow({ sha256: sha256Hex(Buffer.from('hello')) }));
    sourceDocuments.seed(createSourceDocumentRow({ file_blob_id: blob.id, status: 'archived' }));
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const result = await service.uploadFile(
      {
        spaceId: TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('hello'), { originalname: 'report.pdf' }),
      },
      createAdminContext(),
    );

    expect(result).toEqual({
      source_document_id: 'source-1',
      file_blob_id: blob.id,
      job_id: null,
      status: 'archived',
      created: false,
    });
    expect(storage.uploadToQuarantine).not.toHaveBeenCalled();
    expect(jobs.created).toHaveLength(0);
  });

  it('reuses existing blobs across spaces and creates a new archived source document', async () => {
    const { service, db, storage, fileBlobs, sourceDocuments, jobs } = createServiceContext();
    fileBlobs.seed(createFileBlobRow({ sha256: sha256Hex(Buffer.from('hello')) }));
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const result = await service.uploadFile(
      {
        spaceId: TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('hello'), { originalname: 'copy.pdf' }),
      },
      createAdminContext(),
    );

    expect(result.created).toBe(true);
    expect(result.status).toBe('archived');
    expect(storage.uploadToQuarantine).not.toHaveBeenCalled();
    expect(sourceDocuments.rows).toHaveLength(1);
    expect(sourceDocuments.rows[0]?.file_blob_id).toBe('blob-1');
    expect(jobs.created[0]?.queue_name).toBe('ingestion');
  });

  it.each([
    { size: 25 * 1024 * 1024, expectedPriority: 100 },
    { size: 75 * 1024 * 1024, expectedPriority: 200 },
  ])('routes $size byte files to validation with priority $expectedPriority', async ({ size, expectedPriority }) => {
    const { service, db, jobs, sourceDocuments } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const result = await service.uploadFile(
      {
        spaceId: TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('medium'), { size, originalname: 'large.pdf' }),
      },
      createAdminContext(),
    );

    expect(result.status).toBe('validating');
    expect(sourceDocuments.rows[0]?.status).toBe('validating');
    expect(jobs.created[0]).toMatchObject({
      queue_name: 'validation',
      type: 'validation',
      priority: expectedPriority,
      payload_json: {
        source_document_id: 'source-1',
        quarantine_uri: expect.stringContaining('quarantine/') as string,
        quarantine_key: expect.stringContaining('quarantine/') as string,
      },
    });
  });

  it('does not mark cross-space duplicates as archived while their shared blob is still quarantined', async () => {
    const { service, db, fileBlobs, sourceDocuments, jobs } = createServiceContext();
    fileBlobs.seed(
      createFileBlobRow({
        sha256: sha256Hex(Buffer.from('medium')),
        storage_uri: 's3://cherrywiki-uploads/quarantine/tenant-1/space-1/upload-1_medium.pdf',
      }),
    );
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const result = await service.uploadFile(
      {
        spaceId: TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('medium'), {
          size: 25 * 1024 * 1024,
          originalname: 'medium.pdf',
        }),
      },
      createAdminContext(),
    );

    expect(result.status).toBe('validating');
    expect(sourceDocuments.rows[0]).toMatchObject({
      status: 'validating',
      file_blob_id: 'blob-1',
    });
    expect(sourceDocuments.rows[0]?.metadata_json).toMatchObject({
      quarantine_uri: 's3://cherrywiki-uploads/quarantine/tenant-1/space-1/upload-1_medium.pdf',
      quarantine_key: 'quarantine/tenant-1/space-1/upload-1_medium.pdf',
    });
    expect(jobs.created[0]).toMatchObject({
      queue_name: 'validation',
      type: 'validation',
      payload_json: {
        source_document_id: 'source-1',
        quarantine_key: 'quarantine/tenant-1/space-1/upload-1_medium.pdf',
      },
    });
  });

  it('rejects files larger than 200MB before storage writes', async () => {
    const { service, db, storage } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const err = await getRejectedHttpException(
      service.uploadFile(
        {
          spaceId: TEST_SPACE_ID,
          file: createUploadedFile(Buffer.from('too large'), { size: UPLOAD_MAX_BYTES + 1 }),
        },
        createAdminContext(),
      ),
    );

    expect(err.getStatus()).toBe(413);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.FILE_TOO_LARGE);
    expect(storage.uploadToQuarantine).not.toHaveBeenCalled();
  });

  it('returns 422 and records rejection when synchronous validation rejects a disguised binary upload', async () => {
    const { service, db, storage, sourceDocuments } = createServiceContext({ validation: 'real' });
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const err = await getRejectedHttpException(
      service.uploadFile(
        {
          spaceId: TEST_SPACE_ID,
          file: createUploadedFile(Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(128)]), {
            originalname: 'report.pdf',
            mimetype: 'application/pdf',
          }),
        },
        createAdminContext(),
      ),
    );

    expect(err.getStatus()).toBe(422);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.MIME_MISMATCH);
    expect(getHttpExceptionErrorCode(err)).toBe(ErrorCode.MIME_MISMATCH);
    expect(sourceDocuments.rows[0]).toMatchObject({
      status: 'security_rejected',
      metadata_json: {
        rejection_reason: ErrorCode.MIME_MISMATCH,
      },
    });
    expect(storage.promoteToArchive).not.toHaveBeenCalled();
  });

  it('creates URL upload source documents and url-fetch jobs', async () => {
    const { service, db, sourceDocuments, jobs } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const result = await service.uploadUrl(
      {
        spaceId: TEST_SPACE_ID,
        url: 'https://example.com/docs/report',
        metadata: { processing_strategy: 'stash' },
      },
      createAdminContext(),
    );

    expect(result).toMatchObject({
      file_blob_id: null,
      job_id: 'job-1',
      status: 'uploaded',
    });
    expect(sourceDocuments.rows[0]).toMatchObject({
      source_type: 'url',
      file_blob_id: null,
      filename: 'report',
      metadata_json: {
        source_url: 'https://example.com/docs/report',
        processing_strategy: 'stash',
      },
    });
    expect(jobs.created[0]).toMatchObject({
      queue_name: 'url-fetch',
      type: 'url_fetch',
    });
  });

  it.each([
    { url: 'ftp://example.com/file', code: ErrorCode.INVALID_URL_PROTOCOL },
    { url: 'not a url', code: ErrorCode.INVALID_URL_FORMAT },
  ])('rejects invalid URL uploads with $code', async ({ url, code }) => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const err = await getRejectedHttpException(
      service.uploadUrl({ spaceId: TEST_SPACE_ID, url }, createAdminContext()),
    );

    expect(err.getStatus()).toBe(400);
    expect(getHttpExceptionCode(err)).toBe(code);
  });

  it('reprocesses parse_failed uploads and rejects non-reprocessable states', async () => {
    const { service, fileBlobs, sourceDocuments, jobs } = createServiceContext();
    fileBlobs.seed(createFileBlobRow());
    sourceDocuments.seed(createSourceDocumentRow({ status: 'parse_failed' }));

    const result = await service.reprocess('source-1', createAdminContext());

    expect(result.status).toBe('uploaded');
    expect(jobs.created[0]).toMatchObject({
      queue_name: 'ingestion',
      type: 'ingestion',
    });

    sourceDocuments.rows[0] = createSourceDocumentRow({ status: 'parsed' });
    const parsedErr = await getRejectedHttpException(service.reprocess('source-1', createAdminContext()));
    expect(parsedErr.getStatus()).toBe(409);

    sourceDocuments.rows[0] = createSourceDocumentRow({ status: 'security_rejected' });
    const rejectedErr = await getRejectedHttpException(service.reprocess('source-1', createAdminContext()));
    expect(rejectedErr.getStatus()).toBe(409);
  });

  it('marks reprocessed uploaded documents parsed and stores parsed URI in the column', async () => {
    const { service, sourceDocuments } = createServiceContext();
    sourceDocuments.seed(
      createSourceDocumentRow({
        status: 'uploaded',
        metadata_json: {
          processing_strategy: 'stash',
        },
      }),
    );

    await service.markIngestionComplete(
      'source-1',
      {
        parsedUri: 's3://cherrywiki-parsed/source-1.md',
        previewUri: 's3://cherrywiki-previews/source-1.json',
      },
      createAdminContext(),
    );

    expect(sourceDocuments.rows[0]).toMatchObject({
      status: 'parsed',
      parsed_uri: 's3://cherrywiki-parsed/source-1.md',
      metadata_json: {
        processing_strategy: 'stash',
        parsed_uri: 's3://cherrywiki-parsed/source-1.md',
        preview_uri: 's3://cherrywiki-previews/source-1.json',
        parsed_at: expect.any(String) as string,
      },
    });
  });

  it('marks reprocessed uploaded documents parse_failed through the legal state path', async () => {
    const { service, sourceDocuments } = createServiceContext();
    sourceDocuments.seed(createSourceDocumentRow({ status: 'uploaded' }));

    await service.markIngestionFailed('source-1', createAdminContext());

    expect(sourceDocuments.rows[0]?.status).toBe('parse_failed');
  });

  it('links fetched URL content, archives the URL source, and queues ingestion', async () => {
    const { service, sourceDocuments, jobs } = createServiceContext();
    sourceDocuments.seed(
      createSourceDocumentRow({
        id: 'source-url',
        source_type: 'url',
        file_blob_id: null,
        status: 'uploaded',
      }),
    );

    const result = await service.linkBlob(
      {
        sourceDocumentId: 'source-url',
        sha256: sha256Hex(Buffer.from('fetched')),
        sizeBytes: 7,
        mimeType: 'text/html',
        storageUri: 's3://cherrywiki-archives/archive/tenant-1/space-1/2026/04/30/fetched.snapshot',
        filename: 'example.com',
      },
      createAdminContext(),
    );

    expect(result).toMatchObject({
      id: 'source-url',
      status: 'archived',
      sha256: sha256Hex(Buffer.from('fetched')),
    });
    expect(sourceDocuments.rows[0]).toMatchObject({
      status: 'archived',
      file_blob_id: 'blob-1',
    });
    expect(jobs.created[0]).toMatchObject({
      queue_name: 'ingestion',
      type: 'ingestion',
      payload_json: {
        source_document_id: 'source-url',
        archive_uri: 's3://cherrywiki-archives/archive/tenant-1/space-1/2026/04/30/fetched.snapshot',
      },
    });
  });

  it('finalizes duplicate URL source documents instead of leaving them uploaded', async () => {
    const { service, fileBlobs, sourceDocuments, jobs } = createServiceContext();
    const blob = fileBlobs.seed(
      createFileBlobRow({
        id: 'blob-existing',
        sha256: sha256Hex(Buffer.from('fetched')),
      }),
    );
    sourceDocuments.seed(createSourceDocumentRow({ id: 'source-existing', file_blob_id: blob.id, status: 'archived' }));
    sourceDocuments.seed(
      createSourceDocumentRow({
        id: 'source-url',
        source_type: 'url',
        file_blob_id: null,
        status: 'uploaded',
      }),
    );

    const result = await service.linkBlob(
      {
        sourceDocumentId: 'source-url',
        sha256: blob.sha256,
        sizeBytes: blob.size_bytes,
        mimeType: blob.mime_type,
        storageUri: blob.storage_uri,
        filename: 'example.com',
      },
      createAdminContext(),
    );

    expect(result).toMatchObject({
      id: 'source-url',
      status: 'archived',
    });
    expect(sourceDocuments.rows[1]).toMatchObject({
      status: 'archived',
      file_blob_id: null,
      metadata_json: {
        duplicate: true,
        duplicate_of_source_document_id: 'source-existing',
        duplicate_file_blob_id: blob.id,
      },
    });
    expect(jobs.created).toHaveLength(0);
  });

  it('falls back to the existing file blob when a concurrent create hits the unique constraint', async () => {
    const { service, db, storage, fileBlobs } = createServiceContext();
    const existing = createFileBlobRow({ id: 'blob-existing', sha256: sha256Hex(Buffer.from('hello')) });
    fileBlobs.findByShaQueue.push(undefined, existing);
    fileBlobs.createError = createUniqueViolation('file_blobs_tenant_id_sha256_unique');
    db.queueSelect([{ id: TEST_SPACE_ID }]);

    const result = await service.uploadFile(
      {
        spaceId: TEST_SPACE_ID,
        file: createUploadedFile(Buffer.from('hello'), { originalname: 'report.pdf' }),
      },
      createAdminContext(),
    );

    expect(result.file_blob_id).toBe('blob-existing');
    expect(storage.deleteQuarantineFile).toHaveBeenCalledTimes(1);
  });

  it('creates one graphify job for a parsed immediate batch and marks documents pending', async () => {
    const { service, sourceDocuments, jobs } = createServiceContext();
    for (let index = 0; index < 5; index += 1) {
      sourceDocuments.seed(
        createSourceDocumentRow({
          id: `source-${index + 1}`,
          status: 'parsed',
          metadata_json: {
            batch_id: 'batch-1',
            processing_strategy: 'immediate',
          },
        }),
      );
    }

    for (const row of [...sourceDocuments.rows]) {
      await service.handleGraphifyHandoff(row.id, createAdminContext());
    }

    expect(jobs.created.filter((job) => job.type === 'graphify')).toHaveLength(1);
    expect(jobs.created[0]?.payload_json).toMatchObject({
      batch_id: 'batch-1',
      source_document_ids: ['source-1', 'source-2', 'source-3', 'source-4', 'source-5'],
    });
    expect(sourceDocuments.rows.every((row) => row.status === 'graphify_pending')).toBe(true);
  });

  it('does not graphify parsed documents with stash strategy', async () => {
    const { service, sourceDocuments, jobs } = createServiceContext();
    sourceDocuments.seed(
      createSourceDocumentRow({
        status: 'parsed',
        metadata_json: {
          batch_id: 'batch-1',
          processing_strategy: 'stash',
        },
      }),
    );

    await expect(service.handleGraphifyHandoff('source-1', createAdminContext())).resolves.toBeNull();
    expect(jobs.created).toHaveLength(0);
  });

  it('returns 403 when upload create permission is missing', async () => {
    const { service, db } = createServiceContext();
    db.queueSelect([{ id: TEST_SPACE_ID }]);
    db.queueSelect([]);

    const err = await getRejectedHttpException(
      service.uploadFile(
        {
          spaceId: TEST_SPACE_ID,
          file: createUploadedFile(Buffer.from('hello')),
        },
        createViewerContext(),
      ),
    );

    expect(err.getStatus()).toBe(403);
    expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
  });
});

function createServiceContext(options: { validation?: 'pass' | 'real' } = {}): {
  service: UploadsService;
  db: ScriptedDb;
  storage: FakeStorageService;
  fileBlobs: InMemoryFileBlobRepository;
  sourceDocuments: InMemorySourceDocumentRepository;
  jobs: JobCreateHarness;
} {
  const db = new ScriptedDb();
  const storage = new FakeStorageService();
  const fileBlobs = new InMemoryFileBlobRepository();
  const sourceDocuments = new InMemorySourceDocumentRepository();
  const jobs = new JobCreateHarness();
  vi.spyOn(JobRepository, 'create').mockImplementation((jobDb, data) => jobs.create(jobDb, data));
  const validationPipeline =
    options.validation === 'real'
      ? new ValidationPipeline(
          new MimeValidator(),
          new ZipValidator(),
          new PromptInjectionScanner(),
          sourceDocuments as unknown as SourceDocumentRepository,
        )
      : createPassingValidationPipeline();
  const service = new UploadsService(
    db.asDrizzle(),
    storage as unknown as StorageService,
    fileBlobs as unknown as FileBlobRepository,
    sourceDocuments as unknown as SourceDocumentRepository,
    validationPipeline as unknown as ValidationPipeline,
  );

  return { service, db, storage, fileBlobs, sourceDocuments, jobs };
}

function createPassingValidationPipeline(): Pick<ValidationPipeline, 'validateAndRecord' | 'markPromptInjectionScan'> {
  return {
    validateAndRecord: vi.fn((): Promise<RecordedValidationPipelineResult> => Promise.resolve({ pass: true })),
    markPromptInjectionScan: vi.fn((sourceDocument: SourceDocumentRow) => Promise.resolve(sourceDocument)),
  };
}

class FakeStorageService {
  readonly uploadToQuarantine = vi.fn((input: Parameters<StorageService['uploadToQuarantine']>[0]) => {
    const key = ArchivePathHelper.quarantinePath(input);
    return Promise.resolve({
      bucket: 'cherrywiki-uploads',
      key,
      uri: `s3://cherrywiki-uploads/${key}`,
    });
  });

  readonly promoteToArchive = vi.fn((input: Parameters<StorageService['promoteToArchive']>[0]) => {
    const key = ArchivePathHelper.originalFilePath(input);
    return Promise.resolve({
      bucket: 'cherrywiki-archives',
      key,
      uri: `s3://cherrywiki-archives/${key}`,
    });
  });

  readonly deleteQuarantineFile = vi.fn<StorageService['deleteQuarantineFile']>(() => Promise.resolve());
}

class InMemoryFileBlobRepository {
  readonly rows: FileBlobRow[] = [];
  readonly findByShaQueue: Array<FileBlobRow | undefined> = [];
  createError?: Error;

  seed(row: FileBlobRow): FileBlobRow {
    this.rows.push(row);
    return row;
  }

  create(input: Parameters<FileBlobRepository['create']>[0]): Promise<FileBlobRow> {
    if (this.createError !== undefined) {
      const err = this.createError;
      delete this.createError;
      return Promise.reject(err);
    }

    const row = createFileBlobRow({
      id: input.id ?? `blob-${this.rows.length + 1}`,
      tenant_id: input.tenant_id,
      sha256: input.sha256,
      size_bytes: input.size_bytes,
      mime_type: input.mime_type,
      storage_uri: input.storage_uri,
    });
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByTenantAndSha256(tenantId: string, sha256: string): Promise<FileBlobRow | undefined> {
    if (this.findByShaQueue.length > 0) {
      return Promise.resolve(this.findByShaQueue.shift());
    }

    return Promise.resolve(this.rows.find((row) => row.tenant_id === tenantId && row.sha256 === sha256));
  }

  findById(id: string): Promise<FileBlobRow | undefined> {
    return Promise.resolve(this.rows.find((row) => row.id === id));
  }

  async updateStorageUri(id: string, storageUri: string): Promise<FileBlobRow> {
    const row = await this.findById(id);
    if (row === undefined) {
      throw new Error(`Missing blob ${id}`);
    }

    row.storage_uri = storageUri;
    return row;
  }
}

class InMemorySourceDocumentRepository {
  readonly rows: SourceDocumentRow[] = [];

  seed(row: SourceDocumentRow): SourceDocumentRow {
    this.rows.push(row);
    return row;
  }

  create(input: Parameters<SourceDocumentRepository['create']>[0]): Promise<SourceDocumentRow> {
    const row = createSourceDocumentRow({
      id: input.id ?? `source-${this.rows.length + 1}`,
      tenant_id: input.tenant_id,
      space_id: input.space_id,
      file_blob_id: input.file_blob_id ?? null,
      filename: input.filename,
      uploader_id: input.uploader_id ?? null,
      source_type: input.source_type ?? 'upload',
      classification: input.classification ?? null,
      status: input.status ?? 'uploaded',
      parsed_uri: input.parsed_uri ?? null,
      metadata_json: input.metadata_json ?? {},
    });
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findById(id: string): Promise<SourceDocumentRow | undefined> {
    return Promise.resolve(this.rows.find((row) => row.id === id));
  }

  findBySpaceAndBlob(
    tenantId: string,
    spaceId: string,
    fileBlobId: string,
  ): Promise<SourceDocumentRow | undefined> {
    return Promise.resolve(this.rows.find(
      (row) => row.tenant_id === tenantId && row.space_id === spaceId && row.file_blob_id === fileBlobId,
    ));
  }

  async updateStatus(
    id: string,
    status: SourceDocumentStatus,
    updates: Partial<Pick<SourceDocumentRow, 'metadata_json' | 'parsed_uri' | 'file_blob_id'>> = {},
  ): Promise<SourceDocumentRow> {
    const row = await this.findById(id);
    if (row === undefined) {
      throw new Error(`Missing source document ${id}`);
    }

    SourceDocumentStateMachine.assertTransition(row.status as SourceDocumentStatus, status);
    row.status = status;
    row.updated_at = new Date();
    if (updates.metadata_json !== undefined) {
      row.metadata_json = updates.metadata_json;
    }
    if (updates.parsed_uri !== undefined) {
      row.parsed_uri = updates.parsed_uri;
    }
    if (updates.file_blob_id !== undefined) {
      row.file_blob_id = updates.file_blob_id;
    }

    return row;
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<SourceDocumentRow> {
    const row = await this.findById(id);
    if (row === undefined) {
      throw new Error(`Missing source document ${id}`);
    }

    row.metadata_json = metadata;
    return row;
  }

  async linkBlob(id: string, fileBlobId: string, metadata: Record<string, unknown>): Promise<SourceDocumentRow> {
    const row = await this.findById(id);
    if (row === undefined) {
      throw new Error(`Missing source document ${id}`);
    }

    row.file_blob_id = fileBlobId;
    row.metadata_json = metadata;
    return row;
  }

  findByFilter(): Promise<never> {
    return Promise.reject(new Error('findByFilter is not used by these tests'));
  }

  findRecentBatchId(tenantId: string, spaceId: string, since: Date): Promise<string | undefined> {
    const recent = [...this.rows]
      .reverse()
      .find((row) => row.tenant_id === tenantId && row.space_id === spaceId && row.created_at >= since);
    const metadata = recent?.metadata_json;
    if (typeof metadata === 'object' && metadata !== null && 'batch_id' in metadata && typeof metadata.batch_id === 'string') {
      return Promise.resolve(metadata.batch_id);
    }

    return Promise.resolve(undefined);
  }

  findByBatch(tenantId: string, spaceId: string, batchId: string): Promise<SourceDocumentRow[]> {
    return Promise.resolve(this.rows.filter((row) => {
      const metadata = row.metadata_json;
      return (
        row.tenant_id === tenantId &&
        row.space_id === spaceId &&
        typeof metadata === 'object' &&
        metadata !== null &&
        'batch_id' in metadata &&
        metadata.batch_id === batchId
      );
    }));
  }
}

class JobCreateHarness {
  readonly created: JobCreateInput[] = [];
  private readonly rowsByIdempotencyKey = new Map<string, JobRow>();

  create(_db: unknown, input: JobCreateInput): Promise<JobRow> {
    if (input.idempotency_key !== undefined && input.idempotency_key !== null) {
      const existing = this.rowsByIdempotencyKey.get(input.idempotency_key);
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }
    }

    const row = createJobRow({
      id: `job-${this.rowsByIdempotencyKey.size + this.created.length + 1}`,
      tenant_id: input.tenant_id,
      space_id: input.space_id ?? null,
      queue_name: input.queue_name ?? 'default',
      type: input.type,
      priority: input.priority ?? 100,
      payload_json: input.payload_json ?? {},
      idempotency_key: input.idempotency_key ?? null,
      created_by: input.created_by ?? null,
    });
    this.created.push(input);
    if (input.idempotency_key !== undefined && input.idempotency_key !== null) {
      this.rowsByIdempotencyKey.set(input.idempotency_key, row);
    }

    return Promise.resolve(row);
  }
}

function createUploadedFile(
  buffer: Buffer,
  overrides: Partial<{
    originalname: string;
    mimetype: string;
    size: number;
  }> = {},
): {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
} {
  return {
    originalname: overrides.originalname ?? 'report.pdf',
    mimetype: overrides.mimetype ?? 'application/pdf',
    size: overrides.size ?? buffer.length,
    buffer,
  };
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function getHttpExceptionErrorCode(err: unknown): unknown {
  if (!(err instanceof Error) || !('getResponse' in err) || typeof (err as Record<string, unknown>).getResponse !== 'function') {
    return undefined;
  }

  const response = ((err as Record<string, unknown>).getResponse as () => unknown)();
  if (typeof response !== 'object' || response === null || !('error_code' in response)) {
    return undefined;
  }

  return (response as Record<string, unknown>).error_code;
}

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: TEST_TENANT_ID,
    space_id: TEST_SPACE_ID,
    queue_name: 'ingestion',
    type: 'ingestion',
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
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

function createFileBlobRow(overrides: Partial<FileBlobRow> = {}): FileBlobRow {
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

function createSourceDocumentRow(overrides: Partial<SourceDocumentRow> = {}): SourceDocumentRow {
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

function createAdminContext(): UploadContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    actorRole: 'admin',
    userId: TEST_USER_ID,
  };
}

function createViewerContext(): UploadContext {
  return {
    tenantId: TEST_TENANT_ID,
    actorUserId: TEST_USER_ID,
    actorRole: 'viewer',
    userId: TEST_USER_ID,
  };
}
