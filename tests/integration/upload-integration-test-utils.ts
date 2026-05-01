import { createHash } from 'node:crypto';

import { JobRepository, type JobCreateInput, type JobRow } from '@cherrygraph/job-core';
import type { SourceDocumentStatus } from '@cherrygraph/shared';
import { vi } from 'vitest';

import { ArchivePathHelper, type StorageService } from '../../apps/api/src/storage/storage.service.js';
import { SourceDocumentStateMachine } from '../../apps/api/src/uploads/source-document-state.js';
import {
  FileBlobRepository,
  SourceDocumentRepository,
  type FileBlobRow,
  type SourceDocumentRow,
} from '../../apps/api/src/uploads/uploads.repository.js';
import { UploadsService, type UploadContext } from '../../apps/api/src/uploads/uploads.service.js';
import { ScriptedDb } from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';

export const UPLOAD_TEST_TENANT_ID = 'tenant-1';
export const UPLOAD_TEST_SPACE_ID = 'space-1';
export const UPLOAD_TEST_ALT_SPACE_ID = 'space-2';
export const UPLOAD_TEST_USER_ID = 'user-1';

export type UploadIntegrationContext = {
  service: UploadsService;
  db: ScriptedDb;
  storage: IntegrationStorageService;
  fileBlobs: IntegrationFileBlobRepository;
  sourceDocuments: IntegrationSourceDocumentRepository;
  jobs: IntegrationJobHarness;
  queueSpaceExists: (spaceId?: string) => void;
};

export function createUploadIntegrationContext(): UploadIntegrationContext {
  const db = new ScriptedDb();
  const storage = new IntegrationStorageService();
  const fileBlobs = new IntegrationFileBlobRepository();
  const sourceDocuments = new IntegrationSourceDocumentRepository();
  const jobs = new IntegrationJobHarness();
  vi.spyOn(JobRepository, 'create').mockImplementation((jobDb, data) => jobs.create(jobDb, data));
  const service = new UploadsService(
    db.asDrizzle(),
    storage as unknown as StorageService,
    fileBlobs as unknown as FileBlobRepository,
    sourceDocuments as unknown as SourceDocumentRepository,
  );

  return {
    service,
    db,
    storage,
    fileBlobs,
    sourceDocuments,
    jobs,
    queueSpaceExists: (spaceId = UPLOAD_TEST_SPACE_ID) => db.queueSelect([{ id: spaceId }]),
  };
}

export class IntegrationStorageService {
  readonly quarantineUploads: Array<Parameters<StorageService['uploadToQuarantine']>[0] & { key: string; uri: string }> = [];
  readonly archivePromotions: Array<Parameters<StorageService['promoteToArchive']>[0] & { key: string; uri: string }> = [];
  readonly deletedQuarantineKeys: string[] = [];

  async uploadToQuarantine(input: Parameters<StorageService['uploadToQuarantine']>[0]): Promise<{
    bucket: string;
    key: string;
    uri: string;
  }> {
    const key = ArchivePathHelper.quarantinePath(input);
    const uri = `s3://cherrywiki-uploads/${key}`;
    this.quarantineUploads.push({ ...input, key, uri });
    return { bucket: 'cherrywiki-uploads', key, uri };
  }

  async promoteToArchive(input: Parameters<StorageService['promoteToArchive']>[0]): Promise<{
    bucket: string;
    key: string;
    uri: string;
  }> {
    const key = ArchivePathHelper.originalFilePath(input);
    const uri = `s3://cherrywiki-archives/${key}`;
    this.archivePromotions.push({ ...input, key, uri });
    this.deletedQuarantineKeys.push(input.quarantineKey);
    return { bucket: 'cherrywiki-archives', key, uri };
  }

  async deleteQuarantineFile(key: string): Promise<void> {
    this.deletedQuarantineKeys.push(key);
  }
}

export class IntegrationFileBlobRepository {
  readonly rows: FileBlobRow[] = [];

  seed(row: Partial<FileBlobRow> = {}): FileBlobRow {
    const seeded = createFileBlobRow(row);
    this.rows.push(seeded);
    return seeded;
  }

  async create(input: Parameters<FileBlobRepository['create']>[0]): Promise<FileBlobRow> {
    const existing = this.rows.find((row) => row.tenant_id === input.tenant_id && row.sha256 === input.sha256);
    if (existing !== undefined) {
      throw Object.assign(new Error('duplicate file blob'), {
        code: '23505',
        constraint: 'file_blobs_tenant_id_sha256_unique',
      });
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
    return row;
  }

  async findByTenantAndSha256(tenantId: string, sha256: string): Promise<FileBlobRow | undefined> {
    return this.rows.find((row) => row.tenant_id === tenantId && row.sha256 === sha256);
  }

  async findById(id: string): Promise<FileBlobRow | undefined> {
    return this.rows.find((row) => row.id === id);
  }

  async updateStorageUri(id: string, storageUri: string): Promise<FileBlobRow> {
    const row = await this.findById(id);
    if (row === undefined) {
      throw new Error(`Missing file blob ${id}`);
    }

    row.storage_uri = storageUri;
    return row;
  }
}

export class IntegrationSourceDocumentRepository {
  readonly rows: SourceDocumentRow[] = [];

  seed(row: Partial<SourceDocumentRow> = {}): SourceDocumentRow {
    const seeded = createSourceDocumentRow(row);
    this.rows.push(seeded);
    return seeded;
  }

  async create(input: Parameters<SourceDocumentRepository['create']>[0]): Promise<SourceDocumentRow> {
    if (
      input.file_blob_id !== undefined &&
      input.file_blob_id !== null &&
      this.rows.some((row) => row.space_id === input.space_id && row.file_blob_id === input.file_blob_id)
    ) {
      throw Object.assign(new Error('duplicate source document'), {
        code: '23505',
        constraint: 'source_documents_space_id_file_blob_id_unique',
      });
    }

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
    return row;
  }

  async findById(id: string): Promise<SourceDocumentRow | undefined> {
    return this.rows.find((row) => row.id === id);
  }

  async findBySpaceAndBlob(
    tenantId: string,
    spaceId: string,
    fileBlobId: string,
  ): Promise<SourceDocumentRow | undefined> {
    return this.rows.find(
      (row) => row.tenant_id === tenantId && row.space_id === spaceId && row.file_blob_id === fileBlobId,
    );
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

  async findRecentBatchId(tenantId: string, spaceId: string, since: Date): Promise<string | undefined> {
    const recent = [...this.rows]
      .reverse()
      .find((row) => row.tenant_id === tenantId && row.space_id === spaceId && row.created_at >= since);
    const metadata = recent?.metadata_json;
    if (typeof metadata === 'object' && metadata !== null && 'batch_id' in metadata) {
      const batchId = metadata.batch_id;
      return typeof batchId === 'string' ? batchId : undefined;
    }

    return undefined;
  }

  async findByBatch(tenantId: string, spaceId: string, batchId: string): Promise<SourceDocumentRow[]> {
    return this.rows.filter((row) => {
      const metadata = row.metadata_json;
      return (
        row.tenant_id === tenantId &&
        row.space_id === spaceId &&
        typeof metadata === 'object' &&
        metadata !== null &&
        'batch_id' in metadata &&
        metadata.batch_id === batchId
      );
    });
  }
}

export class IntegrationJobHarness {
  readonly created: JobCreateInput[] = [];
  readonly rows: JobRow[] = [];
  private readonly rowsByIdempotencyKey = new Map<string, JobRow>();

  async create(_db: unknown, input: JobCreateInput): Promise<JobRow> {
    if (input.idempotency_key !== undefined && input.idempotency_key !== null) {
      const existing = this.rowsByIdempotencyKey.get(input.idempotency_key);
      if (existing !== undefined) {
        return existing;
      }
    }

    const row = createJobRow({
      id: input.id ?? `job-${this.rows.length + 1}`,
      tenant_id: input.tenant_id,
      space_id: input.space_id ?? null,
      queue_name: input.queue_name ?? 'default',
      type: input.type,
      priority: input.priority ?? 100,
      status: input.status ?? 'pending',
      payload_json: input.payload_json ?? {},
      idempotency_key: input.idempotency_key ?? null,
      created_by: input.created_by ?? null,
    });
    this.created.push(input);
    this.rows.push(row);
    if (row.idempotency_key !== null) {
      this.rowsByIdempotencyKey.set(row.idempotency_key, row);
    }

    return row;
  }
}

export function createUploadedFile(
  buffer: Buffer,
  overrides: Partial<{ originalname: string; mimetype: string; size: number }> = {},
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

export function createAdminUploadContext(overrides: Partial<UploadContext> = {}): UploadContext {
  return {
    tenantId: UPLOAD_TEST_TENANT_ID,
    actorUserId: UPLOAD_TEST_USER_ID,
    actorRole: 'admin',
    userId: UPLOAD_TEST_USER_ID,
    ...overrides,
  };
}

export function createViewerUploadContext(overrides: Partial<UploadContext> = {}): UploadContext {
  return {
    tenantId: UPLOAD_TEST_TENANT_ID,
    actorUserId: UPLOAD_TEST_USER_ID,
    actorRole: 'viewer',
    userId: UPLOAD_TEST_USER_ID,
    ...overrides,
  };
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function createFileBlobRow(overrides: Partial<FileBlobRow> = {}): FileBlobRow {
  return {
    id: 'blob-1',
    tenant_id: UPLOAD_TEST_TENANT_ID,
    sha256: 'a'.repeat(64),
    size_bytes: 1024,
    mime_type: 'application/pdf',
    storage_uri: 's3://cherrywiki-archives/archive/report.pdf',
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    ...overrides,
  };
}

export function createSourceDocumentRow(overrides: Partial<SourceDocumentRow> = {}): SourceDocumentRow {
  return {
    id: 'source-1',
    tenant_id: UPLOAD_TEST_TENANT_ID,
    space_id: UPLOAD_TEST_SPACE_ID,
    file_blob_id: 'blob-1',
    filename: 'report.pdf',
    uploader_id: UPLOAD_TEST_USER_ID,
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

function createJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    tenant_id: UPLOAD_TEST_TENANT_ID,
    space_id: UPLOAD_TEST_SPACE_ID,
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
    created_by: UPLOAD_TEST_USER_ID,
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}
