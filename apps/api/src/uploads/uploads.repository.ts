import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  file_blobs,
  sourceDocumentStatusSchema,
  source_documents,
  type SourceDocumentStatus,
} from '@cherrygraph/shared';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { buildPaginationMeta, parseSortField, type PaginatedResponse, paginatedResponse } from '../common/dto/pagination.dto.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { SourceDocumentStateMachine, SourceDocumentStateTransitionError } from './source-document-state.js';

type UploadsDatabase = NodePgDatabase;
type FileBlobInsert = typeof file_blobs.$inferInsert;
type SourceDocumentInsert = typeof source_documents.$inferInsert;
export type FileBlobRow = typeof file_blobs.$inferSelect;
export type SourceDocumentRow = typeof source_documents.$inferSelect;
type SourceDocumentSortField = 'created_at' | 'updated_at' | 'filename' | 'status';

export type SourceDocumentFilter = {
  tenant_id: string;
  space_id?: string;
  source_type?: string;
  status?: string;
  search?: string;
  page?: number;
  perPage?: number;
  sort?: string;
};

export class SourceDocumentConflictError extends Error {
  readonly code = ErrorCode.CONFLICT;

  constructor(message: string, readonly causeError?: unknown) {
    super(message);
    this.name = 'SourceDocumentConflictError';
  }
}

@Injectable()
export class FileBlobRepository {
  constructor(@Inject(DRIZZLE) private readonly db: UploadsDatabase) {}

  async create(data: Omit<FileBlobInsert, 'id'> & { id?: string }): Promise<FileBlobRow> {
    const [created] = await this.db
      .insert(file_blobs)
      .values({
        id: data.id ?? randomUUID(),
        tenant_id: data.tenant_id,
        sha256: data.sha256,
        size_bytes: data.size_bytes,
        mime_type: data.mime_type,
        storage_uri: data.storage_uri,
        ...(data.created_at !== undefined ? { created_at: data.created_at } : {}),
      })
      .returning();

    if (created === undefined) {
      throw new Error('Failed to create file blob');
    }

    return created;
  }

  async findByTenantAndSha256(tenantId: string, sha256: string): Promise<FileBlobRow | undefined> {
    const [blob] = await this.db
      .select()
      .from(file_blobs)
      .where(and(eq(file_blobs.tenant_id, tenantId), eq(file_blobs.sha256, sha256)))
      .limit(1);

    return blob;
  }

  async findById(id: string): Promise<FileBlobRow | undefined> {
    const [blob] = await this.db.select().from(file_blobs).where(eq(file_blobs.id, id)).limit(1);
    return blob;
  }

  async updateStorageUri(id: string, storageUri: string): Promise<FileBlobRow> {
    const [updated] = await this.db
      .update(file_blobs)
      .set({ storage_uri: storageUri })
      .where(eq(file_blobs.id, id))
      .returning();

    if (updated === undefined) {
      throw new Error(`Failed to update file blob ${id}`);
    }

    return updated;
  }
}

@Injectable()
export class SourceDocumentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: UploadsDatabase) {}

  async create(data: Omit<SourceDocumentInsert, 'id'> & { id?: string }): Promise<SourceDocumentRow> {
    const now = new Date();
    const [created] = await this.db
      .insert(source_documents)
      .values({
        id: data.id ?? randomUUID(),
        tenant_id: data.tenant_id,
        space_id: data.space_id,
        ...(data.file_blob_id !== undefined ? { file_blob_id: data.file_blob_id } : {}),
        filename: data.filename,
        ...(data.uploader_id !== undefined ? { uploader_id: data.uploader_id } : {}),
        ...(data.source_type !== undefined ? { source_type: data.source_type } : {}),
        ...(data.classification !== undefined ? { classification: data.classification } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.parsed_uri !== undefined ? { parsed_uri: data.parsed_uri } : {}),
        ...(data.metadata_json !== undefined ? { metadata_json: data.metadata_json } : {}),
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
      })
      .returning();

    if (created === undefined) {
      throw new Error('Failed to create source document');
    }

    return created;
  }

  async findById(id: string): Promise<SourceDocumentRow | undefined> {
    const [document] = await this.db.select().from(source_documents).where(eq(source_documents.id, id)).limit(1);
    return document;
  }

  async findBySpaceAndBlob(
    tenantId: string,
    spaceId: string,
    fileBlobId: string,
  ): Promise<SourceDocumentRow | undefined> {
    const [document] = await this.db
      .select()
      .from(source_documents)
      .where(
        and(
          eq(source_documents.tenant_id, tenantId),
          eq(source_documents.space_id, spaceId),
          eq(source_documents.file_blob_id, fileBlobId),
        ),
      )
      .limit(1);

    return document;
  }

  async updateStatus(
    id: string,
    newStatus: SourceDocumentStatus,
    updates: Partial<Pick<SourceDocumentInsert, 'metadata_json' | 'parsed_uri' | 'file_blob_id'>> = {},
  ): Promise<SourceDocumentRow> {
    const existing = await this.findById(id);
    if (existing === undefined) {
      throw new SourceDocumentConflictError(`Source document ${id} was not found`);
    }

    const currentStatus = parseSourceDocumentStatus(existing.status);
    try {
      SourceDocumentStateMachine.assertTransition(currentStatus, newStatus);
    } catch (err) {
      if (err instanceof SourceDocumentStateTransitionError) {
        throw new SourceDocumentConflictError(err.message, err);
      }
      throw err;
    }

    const [updated] = await this.db
      .update(source_documents)
      .set({
        status: newStatus,
        updated_at: new Date(),
        ...(updates.metadata_json !== undefined ? { metadata_json: updates.metadata_json } : {}),
        ...(updates.parsed_uri !== undefined ? { parsed_uri: updates.parsed_uri } : {}),
        ...(updates.file_blob_id !== undefined ? { file_blob_id: updates.file_blob_id } : {}),
      })
      .where(and(eq(source_documents.id, id), eq(source_documents.status, currentStatus)))
      .returning();

    if (updated === undefined) {
      throw new SourceDocumentConflictError(`Source document ${id} changed status during update`);
    }

    return updated;
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<SourceDocumentRow> {
    const [updated] = await this.db
      .update(source_documents)
      .set({
        metadata_json: metadata,
        updated_at: new Date(),
      })
      .where(eq(source_documents.id, id))
      .returning();

    if (updated === undefined) {
      throw new SourceDocumentConflictError(`Source document ${id} was not found`);
    }

    return updated;
  }

  async linkBlob(
    id: string,
    fileBlobId: string,
    metadata: Record<string, unknown>,
  ): Promise<SourceDocumentRow> {
    const [updated] = await this.db
      .update(source_documents)
      .set({
        file_blob_id: fileBlobId,
        metadata_json: metadata,
        updated_at: new Date(),
      })
      .where(eq(source_documents.id, id))
      .returning();

    if (updated === undefined) {
      throw new SourceDocumentConflictError(`Source document ${id} was not found`);
    }

    return updated;
  }

  async findByFilter(filter: SourceDocumentFilter): Promise<PaginatedResponse<SourceDocumentRow>> {
    const page = normalizePositiveInt(filter.page, 1);
    const perPage = normalizePositiveInt(filter.perPage, 20, 100);
    const where = buildSourceDocumentWhere(filter);
    const order = buildSourceDocumentOrder(filter.sort ?? '-created_at');

    const rows = await this.db
      .select()
      .from(source_documents)
      .where(where)
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);

    const [countRow] = await this.db.select({ total: count() }).from(source_documents).where(where);

    return paginatedResponse(rows, buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)));
  }

  async findRecentBatchId(tenantId: string, spaceId: string, since: Date): Promise<string | undefined> {
    const [row] = await this.db
      .select({ metadata_json: source_documents.metadata_json })
      .from(source_documents)
      .where(
        and(
          eq(source_documents.tenant_id, tenantId),
          eq(source_documents.space_id, spaceId),
          sql`${source_documents.created_at} >= ${since}`,
          sql`${source_documents.metadata_json}->>'batch_id' IS NOT NULL`,
        ),
      )
      .orderBy(desc(source_documents.created_at))
      .limit(1);

    return readBatchId(row?.metadata_json);
  }

  async findByBatch(tenantId: string, spaceId: string, batchId: string): Promise<SourceDocumentRow[]> {
    return this.db
      .select()
      .from(source_documents)
      .where(
        and(
          eq(source_documents.tenant_id, tenantId),
          eq(source_documents.space_id, spaceId),
          sql`${source_documents.metadata_json}->>'batch_id' = ${batchId}`,
        ),
      )
      .orderBy(asc(source_documents.created_at));
  }
}

function buildSourceDocumentWhere(filter: SourceDocumentFilter): SQL {
  const conditions: SQL[] = [eq(source_documents.tenant_id, filter.tenant_id)];

  if (filter.space_id !== undefined) {
    conditions.push(eq(source_documents.space_id, filter.space_id));
  }
  if (filter.source_type !== undefined) {
    conditions.push(eq(source_documents.source_type, filter.source_type));
  }
  if (filter.status !== undefined) {
    conditions.push(eq(source_documents.status, filter.status));
  }
  if (filter.search !== undefined && filter.search.trim().length > 0) {
    const pattern = `%${escapeLikePattern(filter.search.trim())}%`;
    const search = or(ilike(source_documents.filename, pattern), ilike(source_documents.classification, pattern));
    if (search !== undefined) {
      conditions.push(search);
    }
  }

  if (conditions.length === 1) {
    return conditions[0] as SQL;
  }

  return and(...conditions) as SQL;
}

function buildSourceDocumentOrder(sort: string): SQL {
  const parsed = parseSortField(sort);
  const columns = {
    created_at: source_documents.created_at,
    updated_at: source_documents.updated_at,
    filename: source_documents.filename,
    status: source_documents.status,
  } as const satisfies Record<SourceDocumentSortField, unknown>;
  const column = columns[parsed.field as SourceDocumentSortField];

  if (column === undefined) {
    throw new SourceDocumentConflictError('Invalid sort field');
  }

  return parsed.direction === 'desc' ? desc(column) : asc(column);
}

function parseSourceDocumentStatus(status: string): SourceDocumentStatus {
  const parsed = sourceDocumentStatusSchema.safeParse(status);
  if (!parsed.success) {
    throw new SourceDocumentConflictError(`Unknown source document status: ${status}`);
  }

  return parsed.data;
}

function normalizePositiveInt(value: number | undefined, fallback: number, max = Number.POSITIVE_INFINITY): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.min(Math.trunc(value), max);
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function readBatchId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('batch_id' in value)) {
    return undefined;
  }

  const batchId = value.batch_id;
  return typeof batchId === 'string' && batchId.trim().length > 0 ? batchId : undefined;
}
