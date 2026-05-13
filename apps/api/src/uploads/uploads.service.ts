import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JobRepository, job_events, jobs, type JobRow } from '@cherrygraph/job-core';
import {
  ErrorCode,
  graphifyRuns,
  group_members,
  sourceDocumentMetadataSchema,
  space_permissions,
  spaces,
  type SourceDocumentProcessingStrategy,
  type SourceDocumentStatus,
} from '@cherrygraph/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Readable } from 'node:stream';

import { buildPaginationMeta, paginatedResponse, type PaginatedResponse } from '../common/dto/pagination.dto.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { getBucketName, STORAGE_BUCKET_NAMES } from '../storage/storage.constants.js';
import { StorageService } from '../storage/storage.service.js';
import {
  MEDIUM_FILE_MAX_BYTES,
  SMALL_FILE_MAX_BYTES,
  UPLOAD_BATCH_WINDOW_MS,
  UPLOAD_JOB_QUEUES,
  UPLOAD_JOB_TYPES,
  UPLOAD_MAX_BYTES,
} from './uploads.constants.js';
import {
  FileBlobRepository,
  SourceDocumentRepository,
  type FileBlobRow,
  type SourceDocumentRow,
} from './uploads.repository.js';
import type {
  CreateUploadDto,
  UploadDetailDto,
  UploadListQueryDto,
  UploadedFileLike,
  UploadResponseDto,
  UploadStatusDto,
} from './uploads.dto.js';
import { ValidationPipeline, type RecordedValidationPipelineResult } from './validators/validation-pipeline.js';

type UploadsDatabase = NodePgDatabase;
type JsonRecord = Record<string, unknown>;

export type UploadContext = {
  tenantId?: string;
  actorUserId?: string;
  actorRole?: string;
  userId?: string;
  actorPermissions?: string[];
};

export type UploadFileInput = {
  spaceId: string;
  file: UploadedFileLike;
  metadata?: CreateUploadDto;
};

export type UploadUrlInput = {
  spaceId: string;
  url: string;
  metadata?: CreateUploadDto;
};

export type LinkBlobInput = {
  sourceDocumentId: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  storageUri: string;
  filename?: string;
};

export type CompleteValidationInput = {
  sourceDocumentId: string;
  quarantineKey: string;
};

const READ_SATISFYING_PERMISSIONS = ['upload:read', 'upload:create', 'space:view', 'space:edit', 'space:admin'] as const;
const CREATE_SATISFYING_PERMISSIONS = ['upload:create', 'space:edit', 'space:admin'] as const;
const IMPLICIT_SPACE_ROLES = new Set(['owner', 'admin']);

@Injectable()
export class UploadsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: UploadsDatabase,
    private readonly storageService: StorageService,
    private readonly fileBlobRepository: FileBlobRepository,
    private readonly sourceDocumentRepository: SourceDocumentRepository,
    private readonly validationPipeline: ValidationPipeline,
  ) {}

  async uploadFile(input: UploadFileInput, context: UploadContext = {}): Promise<UploadResponseDto> {
    const tenantId = resolveTenantId(context);
    const userId = resolveContextUserId(context);
    await this.assertSpaceExists(tenantId, input.spaceId);
    await this.assertSpacePermission(tenantId, userId, input.spaceId, context, [...CREATE_SATISFYING_PERMISSIONS]);

    if (input.file.size > UPLOAD_MAX_BYTES || input.file.buffer.length > UPLOAD_MAX_BYTES) {
      throwApiError(ErrorCode.FILE_TOO_LARGE, 'File exceeds the 200MB upload limit', HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const sha256 = createHash('sha256').update(input.file.buffer).digest('hex');
    const now = new Date();
    const batchId = await this.assignBatchId(tenantId, input.spaceId, now);
    const baseMetadata = this.normalizeMetadata(input.metadata, { batchId });
    const existingBlob = await this.fileBlobRepository.findByTenantAndSha256(tenantId, sha256);

    if (existingBlob !== undefined) {
      return this.createSourceForExistingBlob({
        tenantId,
        spaceId: input.spaceId,
        userId,
        file: input.file,
        blob: existingBlob,
        metadata: baseMetadata,
        priority: priorityForSize(input.file.size),
      });
    }

    const uploadId = randomUUID();
    const quarantine = await this.storageService.uploadToQuarantine({
      tenantId,
      spaceId: input.spaceId,
      uploadId,
      filename: input.file.originalname,
      body: input.file.buffer,
      contentType: normalizeContentType(input.file.mimetype),
      maxBytes: UPLOAD_MAX_BYTES,
    });
    let blob: FileBlobRow;

    try {
      blob = await this.fileBlobRepository.create({
        tenant_id: tenantId,
        sha256,
        size_bytes: input.file.size,
        mime_type: normalizeContentType(input.file.mimetype),
        storage_uri: quarantine.uri,
      });
    } catch (err) {
      if (!isUniqueViolation(err, 'file_blobs_tenant_id_sha256_unique')) {
        throw err;
      }

      await this.storageService.deleteQuarantineFile(quarantine.key);
      const resolved = await this.fileBlobRepository.findByTenantAndSha256(tenantId, sha256);
      if (resolved === undefined) {
        throw err;
      }

      return this.createSourceForExistingBlob({
        tenantId,
        spaceId: input.spaceId,
        userId,
        file: input.file,
        blob: resolved,
        metadata: baseMetadata,
        priority: priorityForSize(input.file.size),
      });
    }

    const metadata = {
      ...baseMetadata,
      quarantine_uri: quarantine.uri,
      quarantine_key: quarantine.key,
    };
    const sourceDocument = await this.createSourceDocumentWithDedup({
      tenantId,
      spaceId: input.spaceId,
      userId,
      blob,
      filename: input.file.originalname,
      sourceType: 'upload',
      classification: normalizeOptionalString(input.metadata?.classification),
      status: 'uploaded',
      metadata,
    });

    if (!sourceDocument.created) {
      await this.storageService.deleteQuarantineFile(quarantine.key);
      return toUploadResponse(sourceDocument.row, null, false, undefined, true);
    }

    const priority = priorityForSize(input.file.size);
    if (input.file.size <= SMALL_FILE_MAX_BYTES) {
      const validating = await this.sourceDocumentRepository.updateStatus(sourceDocument.row.id, 'validating', {
        metadata_json: metadata,
      });
      const validation = await this.runSecurityValidation(validating, blob, input.file.buffer, userId);
      if (!validation.pass) {
        throwSecurityValidationError(validation);
      }

      const archive = await this.storageService.promoteToArchive({
        tenantId,
        spaceId: input.spaceId,
        quarantineKey: quarantine.key,
        sha256,
        filename: input.file.originalname,
        archivedAt: now,
      });
      const archivedMetadata = {
        ...asJsonRecord(validating.metadata_json),
        archive_uri: archive.uri,
        archive_key: archive.key,
      };
      await this.fileBlobRepository.updateStorageUri(blob.id, archive.uri);
      const archived = await this.sourceDocumentRepository.updateStatus(validating.id, 'archived', {
        metadata_json: archivedMetadata,
      });
      const job = await this.createIngestionJob(
        tenantId,
        input.spaceId,
        userId,
        archived,
        { ...blob, storage_uri: archive.uri },
        priority,
        false,
      );

      return toUploadResponse(archived, job, true);
    }

    const validating = await this.sourceDocumentRepository.updateStatus(sourceDocument.row.id, 'validating', {
      metadata_json: metadata,
    });
    const validationJob = await this.createValidationJob(
      tenantId,
      input.spaceId,
      userId,
      validating,
      quarantine.uri,
      quarantine.key,
      priority,
    );

    return toUploadResponse(validating, validationJob, true);
  }

  async uploadUrl(input: UploadUrlInput, context: UploadContext = {}): Promise<UploadResponseDto> {
    const tenantId = resolveTenantId(context);
    const userId = resolveContextUserId(context);
    await this.assertSpaceExists(tenantId, input.spaceId);
    await this.assertSpacePermission(tenantId, userId, input.spaceId, context, [...CREATE_SATISFYING_PERMISSIONS]);

    const url = parseHttpUrl(input.url);
    const batchId = await this.assignBatchId(tenantId, input.spaceId, new Date());
    const metadata = this.normalizeMetadata(input.metadata, {
      batchId,
      sourceUrl: url.toString(),
    });
    const sourceDocument = await this.sourceDocumentRepository.create({
      tenant_id: tenantId,
      space_id: input.spaceId,
      file_blob_id: null,
      filename: filenameFromUrl(url),
      uploader_id: userId,
      source_type: 'url',
      classification: normalizeOptionalString(input.metadata?.classification),
      status: 'uploaded',
      metadata_json: metadata,
    });
    const job = await JobRepository.create(this.db, {
      tenant_id: tenantId,
      space_id: input.spaceId,
      queue_name: UPLOAD_JOB_QUEUES.URL_FETCH,
      type: UPLOAD_JOB_TYPES.URL_FETCH,
      priority: 100,
      payload_json: {
        source_document_id: sourceDocument.id,
        url: url.toString(),
      },
      idempotency_key: `url-fetch:${sourceDocument.id}`,
      created_by: userId,
    });

    return toUploadResponse(sourceDocument, job, true);
  }

  async getUpload(sourceDocumentId: string, context: UploadContext = {}): Promise<UploadDetailDto> {
    const tenantId = resolveTenantId(context);
    const document = await this.getTenantDocument(sourceDocumentId, tenantId);
    await this.assertSpacePermissionOrNotFound(
      tenantId,
      resolveContextUserId(context),
      document.space_id,
      context,
      [...READ_SATISFYING_PERMISSIONS],
    );

    return this.toUploadDetail(document);
  }

  async getUploadStatus(sourceDocumentId: string, context: UploadContext = {}): Promise<UploadStatusDto> {
    const tenantId = resolveTenantId(context);
    const document = await this.getTenantDocument(sourceDocumentId, tenantId);
    await this.assertSpacePermissionOrNotFound(
      tenantId,
      resolveContextUserId(context),
      document.space_id,
      context,
      [...READ_SATISFYING_PERMISSIONS],
    );

    const job = await this.findLatestJobForSourceDocument(tenantId, document.id);
    const progress = job === undefined ? null : await this.findLatestProgress(job.id);

    return {
      source_document_id: document.id,
      status: document.status,
      job_id: job?.id ?? null,
      job_status: job?.status ?? null,
      progress_percent: progress,
      error_json: job?.error_json ?? null,
    };
  }

  async listUploads(
    spaceId: string,
    query: UploadListQueryDto,
    context: UploadContext = {},
  ): Promise<PaginatedResponse<UploadDetailDto>> {
    const tenantId = resolveTenantId(context);
    await this.assertSpaceExists(tenantId, spaceId);
    await this.assertSpacePermission(
      tenantId,
      resolveContextUserId(context),
      spaceId,
      context,
      [...READ_SATISFYING_PERMISSIONS],
    );

    const result = await this.sourceDocumentRepository.findByFilter({
      tenant_id: tenantId,
      space_id: spaceId,
      ...(query.source_type !== undefined ? { source_type: query.source_type } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
      page: query.page,
      perPage: query.per_page,
      sort: query.sort,
    });
    const items = await Promise.all(result.data.map((row) => this.toUploadDetail(row)));

    return paginatedResponse(items, buildPaginationMeta(result.pagination.page, result.pagination.per_page, result.pagination.total));
  }

  async reprocess(sourceDocumentId: string, context: UploadContext = {}): Promise<UploadResponseDto> {
    const tenantId = resolveTenantId(context);
    const userId = resolveContextUserId(context);
    const document = await this.getTenantDocument(sourceDocumentId, tenantId);
    await this.assertSpacePermissionOrNotFound(tenantId, userId, document.space_id, context, [...CREATE_SATISFYING_PERMISSIONS]);

    if (document.status === 'security_rejected') {
      throwApiError(
        ErrorCode.CONFLICT,
        'Security rejected uploads cannot be reprocessed',
        HttpStatus.CONFLICT,
      );
    }
    if (document.status !== 'parse_failed') {
      throwApiError(
        ErrorCode.CONFLICT,
        'Only parse_failed uploads can be reprocessed',
        HttpStatus.CONFLICT,
      );
    }
    if (document.file_blob_id === null) {
      throwApiError(ErrorCode.CONFLICT, 'Cannot reprocess an upload before file content is linked', HttpStatus.CONFLICT);
    }

    const blob = await this.requireBlob(document.file_blob_id, tenantId);
    const reset = await this.sourceDocumentRepository.updateStatus(document.id, 'uploaded');
    const job = await this.createIngestionJob(
      tenantId,
      reset.space_id,
      userId,
      reset,
      blob,
      priorityForSize(blob.size_bytes),
      true,
    );

    return toUploadResponse(reset, job, true);
  }

  async linkBlob(input: LinkBlobInput, context: UploadContext = {}): Promise<UploadDetailDto> {
    const tenantId = resolveTenantId(context);
    const document = await this.getTenantDocument(input.sourceDocumentId, tenantId);
    const actorUserId = context.actorUserId ?? context.userId ?? document.uploader_id ?? null;
    let blob = await this.fileBlobRepository.findByTenantAndSha256(tenantId, input.sha256);

    if (blob === undefined) {
      try {
        blob = await this.fileBlobRepository.create({
          tenant_id: tenantId,
          sha256: input.sha256,
          size_bytes: input.sizeBytes,
          mime_type: input.mimeType,
          storage_uri: input.storageUri,
        });
      } catch (err) {
        if (!isUniqueViolation(err, 'file_blobs_tenant_id_sha256_unique')) {
          throw err;
        }

        blob = await this.fileBlobRepository.findByTenantAndSha256(tenantId, input.sha256);
        if (blob === undefined) {
          throw err;
        }
      }
    }

    const existingSource = await this.sourceDocumentRepository.findBySpaceAndBlob(tenantId, document.space_id, blob.id);

    if (existingSource !== undefined && existingSource.id !== document.id) {
      const duplicateMetadata = {
        ...asJsonRecord(document.metadata_json),
        linked_at: new Date().toISOString(),
        duplicate: true,
        duplicate_of_source_document_id: existingSource.id,
        duplicate_file_blob_id: blob.id,
        archive_uri: blob.storage_uri,
      };
      const duplicate = await this.sourceDocumentRepository.updateMetadata(document.id, duplicateMetadata);

      if (duplicate.status === 'uploaded') {
        if (!isArchiveStorageUri(blob.storage_uri)) {
          return this.toUploadDetail(duplicate);
        }
        const validating = await this.sourceDocumentRepository.updateStatus(duplicate.id, 'validating', {
          metadata_json: duplicateMetadata,
        });
        const archived = await this.sourceDocumentRepository.updateStatus(validating.id, 'archived', {
          metadata_json: duplicateMetadata,
        });
        return this.toUploadDetail(archived);
      }

      return this.toUploadDetail(duplicate);
    }

    const metadata = {
      ...asJsonRecord(document.metadata_json),
      linked_at: new Date().toISOString(),
    };
    const linked = await this.sourceDocumentRepository.linkBlob(document.id, blob.id, metadata);

    if (linked.status === 'uploaded') {
      const validating = await this.sourceDocumentRepository.updateStatus(linked.id, 'validating', {
        metadata_json: metadata,
      });
      const archived = await this.sourceDocumentRepository.updateStatus(validating.id, 'archived', {
        metadata_json: metadata,
      });
      await this.createIngestionJob(
        tenantId,
        archived.space_id,
        actorUserId,
        archived,
        blob,
        priorityForSize(blob.size_bytes),
        false,
      );
      return this.toUploadDetail(archived);
    }

    return this.toUploadDetail(linked);
  }

  async completeValidation(input: CompleteValidationInput, context: UploadContext = {}): Promise<UploadResponseDto> {
    const tenantId = resolveTenantId(context);
    const userId = resolveContextUserId(context);
    const document = await this.getTenantDocument(input.sourceDocumentId, tenantId);
    if (document.file_blob_id === null) {
      throwApiError(ErrorCode.CONFLICT, 'Cannot archive a source document without a file blob', HttpStatus.CONFLICT);
    }

    const blob = await this.requireBlob(document.file_blob_id, tenantId);
    const archive = await this.storageService.promoteToArchive({
      tenantId,
      spaceId: document.space_id,
      quarantineKey: input.quarantineKey,
      sha256: blob.sha256,
      filename: document.filename,
    });
    await this.fileBlobRepository.updateStorageUri(blob.id, archive.uri);
    const metadata = {
      ...asJsonRecord(document.metadata_json),
      archive_uri: archive.uri,
      archive_key: archive.key,
    };
    const archived = await this.sourceDocumentRepository.updateStatus(document.id, 'archived', {
      metadata_json: metadata,
    });
    const job = await this.createIngestionJob(
      tenantId,
      document.space_id,
      userId,
      archived,
      { ...blob, storage_uri: archive.uri },
      priorityForSize(blob.size_bytes),
      false,
    );

    return toUploadResponse(archived, job, true);
  }

  async validateQuarantinedUpload(
    input: CompleteValidationInput & { buffer?: Buffer },
    context: UploadContext = {},
  ): Promise<RecordedValidationPipelineResult> {
    const tenantId = resolveTenantId(context);
    const userId = resolveContextUserId(context);
    const document = await this.getTenantDocument(input.sourceDocumentId, tenantId);
    if (document.file_blob_id === null) {
      throwApiError(ErrorCode.CONFLICT, 'Cannot validate a source document without a file blob', HttpStatus.CONFLICT);
    }

    const blob = await this.requireBlob(document.file_blob_id, tenantId);
    const buffer = input.buffer ?? await this.readQuarantineFile(input.quarantineKey);
    return this.runSecurityValidation(document, blob, buffer, userId);
  }

  async markIngestionFailed(
    sourceDocumentId: string,
    context: UploadContext = {},
  ): Promise<void> {
    const tenantId = resolveTenantId(context);
    const document = await this.getTenantDocument(sourceDocumentId, tenantId);
    if (document.status === 'parsed' || document.status === 'parse_failed') {
      return;
    }

    const parsingDocument = await this.advanceDocumentToParsing(document);

    await this.sourceDocumentRepository.updateStatus(parsingDocument.id, 'parse_failed');
  }

  async markIngestionComplete(
    sourceDocumentId: string,
    result: { parsedUri?: string; previewUri?: string },
    context: UploadContext = {},
  ): Promise<void> {
    const tenantId = resolveTenantId(context);
    const document = await this.getTenantDocument(sourceDocumentId, tenantId);
    if (document.status === 'parsed' || document.status === 'parse_failed') {
      return;
    }

    const parsingDocument = await this.advanceDocumentToParsing(document);

    await this.sourceDocumentRepository.updateStatus(parsingDocument.id, 'parsed', {
      metadata_json: {
        ...asJsonRecord(parsingDocument.metadata_json),
        ...(result.parsedUri !== undefined ? { parsed_uri: result.parsedUri } : {}),
        ...(result.previewUri !== undefined ? { preview_uri: result.previewUri } : {}),
        parsed_at: new Date().toISOString(),
      },
      ...(result.parsedUri !== undefined ? { parsed_uri: result.parsedUri } : {}),
    });
  }

  async markPromptInjectionScan(
    sourceDocumentId: string,
    parsedMarkdown: string,
    context: UploadContext = {},
  ): Promise<UploadDetailDto> {
    const tenantId = resolveTenantId(context);
    const document = await this.getTenantDocument(sourceDocumentId, tenantId);
    const updated = await this.validationPipeline.markPromptInjectionScan(document, parsedMarkdown);
    return this.toUploadDetail(updated);
  }

  async handleGraphifyHandoff(sourceDocumentId: string, context: UploadContext = {}): Promise<JobRow | null> {
    const tenantId = resolveTenantId(context);
    const document = await this.getTenantDocument(sourceDocumentId, tenantId);
    if (document.status !== 'parsed') {
      return null;
    }

    const metadata = asJsonRecord(document.metadata_json);
    const strategy = normalizeProcessingStrategy(metadata.processing_strategy);
    if (strategy !== 'immediate') {
      return null;
    }

    const batchId = typeof metadata.batch_id === 'string' ? metadata.batch_id : document.id;
    const batchDocuments = await this.sourceDocumentRepository.findByBatch(tenantId, document.space_id, batchId);
    const readyDocuments = batchDocuments.filter(
      (item) => item.status === 'parsed' && normalizeProcessingStrategy(asJsonRecord(item.metadata_json).processing_strategy) === 'immediate',
    );
    const sourceDocumentIds = readyDocuments.length === 0 ? [document.id] : readyDocuments.map((item) => item.id);
    const graphifyDocuments = readyDocuments.length === 0 ? [document] : readyDocuments;
    const inputUris = graphifyDocuments.map(readParsedUriFromMetadata).filter((uri): uri is string => uri !== undefined);
    const runId = randomUUID();
    const createdBy = context.actorUserId ?? context.userId ?? null;
    const now = new Date();
    const job = await this.db.transaction(async (tx) => {
      await tx
        .insert(graphifyRuns)
        .values({
          id: runId,
          tenant_id: tenantId,
          space_id: document.space_id,
          trigger_type: 'upload',
          mode: 'standard',
          status: 'pending',
          schema_version: 'v1',
          stats_json: {
            input_scope: { source_document_ids: sourceDocumentIds },
            batch_id: batchId,
            input_uri_count: inputUris.length,
          },
          created_by: createdBy,
          created_at: now,
        });

      const createdJob = await JobRepository.create(tx, {
        tenant_id: tenantId,
        space_id: document.space_id,
        queue_name: UPLOAD_JOB_QUEUES.GRAPHIFY,
        type: UPLOAD_JOB_TYPES.GRAPHIFY,
        priority: 100,
        payload_json: {
          tenant_id: tenantId,
          space_id: document.space_id,
          run_id: runId,
          mode: 'standard',
          input_uris: inputUris,
          source_document_ids: sourceDocumentIds,
          batch_id: batchId,
        },
        idempotency_key: `graphify:${tenantId}:${document.space_id}:${batchId}`,
        created_by: createdBy,
      });

      await tx.update(graphifyRuns).set({ job_id: createdJob.id }).where(eq(graphifyRuns.id, runId));

      return createdJob;
    });

    for (const item of graphifyDocuments) {
      if (item.status === 'parsed') {
        await this.sourceDocumentRepository.updateStatus(item.id, 'graphify_pending', {
          metadata_json: {
            ...asJsonRecord(item.metadata_json),
            graphify_run_id: runId,
          },
        });
      }
    }

    return job;
  }

  private async createSourceForExistingBlob(input: {
    tenantId: string;
    spaceId: string;
    userId: string;
    file: UploadedFileLike;
    blob: FileBlobRow;
    metadata: JsonRecord;
    priority: number;
  }): Promise<UploadResponseDto> {
    const existingSource = await this.sourceDocumentRepository.findBySpaceAndBlob(
      input.tenantId,
      input.spaceId,
      input.blob.id,
    );

    if (existingSource !== undefined) {
      if (existingSource.status !== 'security_rejected') {
        return toUploadResponse(existingSource, null, false, undefined, true);
      }
      const reset = await this.sourceDocumentRepository.updateStatus(existingSource.id, 'uploaded', {
        metadata_json: clearSecurityRejectionMetadata(existingSource.metadata_json),
      });
      return this.requeueExistingBlobDocument(reset, input, true);
    }

    const isArchivedBlob = isArchiveStorageUri(input.blob.storage_uri);
    const isQuarantinedBlob = isQuarantineStorageUri(input.blob.storage_uri);
    const quarantineKey = isQuarantinedBlob ? storageKeyFromUri(input.blob.storage_uri) : undefined;
    if (!isArchivedBlob && !isQuarantinedBlob) {
      throwApiError(
        ErrorCode.CONFLICT,
        'Existing file blob is neither archived nor quarantined',
        HttpStatus.CONFLICT,
      );
    }

    const sourceDocument = await this.createSourceDocumentWithDedup({
      tenantId: input.tenantId,
      spaceId: input.spaceId,
      userId: input.userId,
      blob: input.blob,
      filename: input.file.originalname,
      sourceType: 'upload',
      classification: normalizeOptionalString(input.metadata.classification),
      status: isArchivedBlob ? 'archived' : 'uploaded',
      metadata: isArchivedBlob
        ? {
            ...input.metadata,
            archive_uri: input.blob.storage_uri,
          }
        : {
            ...input.metadata,
            quarantine_uri: input.blob.storage_uri,
            ...(quarantineKey !== undefined ? { quarantine_key: quarantineKey } : {}),
          },
    });

    if (!sourceDocument.created) {
      return toUploadResponse(sourceDocument.row, null, false, undefined, true);
    }

    return this.requeueExistingBlobDocument(sourceDocument.row, input);
  }

  private async requeueExistingBlobDocument(
    document: SourceDocumentRow,
    input: {
      tenantId: string;
      spaceId: string;
      userId: string;
      blob: FileBlobRow;
      priority: number;
    },
    retryAttempt = false,
  ): Promise<UploadResponseDto> {
    const isArchivedBlob = isArchiveStorageUri(input.blob.storage_uri);
    const isQuarantinedBlob = isQuarantineStorageUri(input.blob.storage_uri);
    const quarantineKey = isQuarantinedBlob ? storageKeyFromUri(input.blob.storage_uri) : undefined;

    if (!isArchivedBlob && !isQuarantinedBlob) {
      throwApiError(
        ErrorCode.CONFLICT,
        'Existing file blob is neither archived nor quarantined',
        HttpStatus.CONFLICT,
      );
    }

    if (!isArchivedBlob) {
      if (quarantineKey === undefined) {
        throwApiError(
          ErrorCode.CONFLICT,
          'Existing file blob is not archived and does not have a quarantine key',
          HttpStatus.CONFLICT,
        );
      }

      const metadata = {
        ...asJsonRecord(document.metadata_json),
        quarantine_uri: input.blob.storage_uri,
        quarantine_key: quarantineKey,
      };
      const validating = await this.sourceDocumentRepository.updateStatus(document.id, 'validating', {
        metadata_json: metadata,
      });
      const validationJob = await this.createValidationJob(
        input.tenantId,
        input.spaceId,
        input.userId,
        validating,
        input.blob.storage_uri,
        quarantineKey,
        input.priority,
        retryAttempt,
      );

      return toUploadResponse(validating, validationJob, true);
    }

    const job = await this.createIngestionJob(
      input.tenantId,
      input.spaceId,
      input.userId,
      document,
      input.blob,
      input.priority,
      false,
    );

    return toUploadResponse(document, job, true);
  }

  private async advanceDocumentToParsing(document: SourceDocumentRow): Promise<SourceDocumentRow> {
    if (document.status === 'uploaded') {
      const validating = await this.sourceDocumentRepository.updateStatus(document.id, 'validating');
      const archived = await this.sourceDocumentRepository.updateStatus(validating.id, 'archived');
      return this.sourceDocumentRepository.updateStatus(archived.id, 'parsing');
    }

    if (document.status === 'archived') {
      return this.sourceDocumentRepository.updateStatus(document.id, 'parsing');
    }

    return document;
  }

  private async createSourceDocumentWithDedup(input: {
    tenantId: string;
    spaceId: string;
    userId: string;
    blob: FileBlobRow;
    filename: string;
    sourceType: string;
    classification: string | null;
    status: SourceDocumentStatus;
    metadata: JsonRecord;
  }): Promise<{ row: SourceDocumentRow; created: boolean }> {
    try {
      return {
        row: await this.sourceDocumentRepository.create({
          tenant_id: input.tenantId,
          space_id: input.spaceId,
          file_blob_id: input.blob.id,
          filename: input.filename,
          uploader_id: input.userId,
          source_type: input.sourceType,
          classification: input.classification,
          status: input.status,
          metadata_json: input.metadata,
        }),
        created: true,
      };
    } catch (err) {
      if (!isUniqueViolation(err, 'source_documents_space_id_file_blob_id_unique')) {
        throw err;
      }

      const existing = await this.sourceDocumentRepository.findBySpaceAndBlob(input.tenantId, input.spaceId, input.blob.id);
      if (existing === undefined) {
        throw err;
      }

      return { row: existing, created: false };
    }
  }

  private async createValidationJob(
    tenantId: string,
    spaceId: string,
    userId: string,
    document: SourceDocumentRow,
    quarantineUri: string,
    quarantineKey: string,
    priority: number,
    retryAttempt = false,
  ): Promise<JobRow> {
    const idempotencyKey = retryAttempt
      ? `validation:${document.id}:retry-${Date.now()}`
      : `validation:${document.id}`;

    return JobRepository.create(this.db, {
      tenant_id: tenantId,
      space_id: spaceId,
      queue_name: UPLOAD_JOB_QUEUES.VALIDATION,
      type: UPLOAD_JOB_TYPES.VALIDATION,
      priority,
      payload_json: {
        source_document_id: document.id,
        quarantine_uri: quarantineUri,
        quarantine_key: quarantineKey,
      },
      idempotency_key: idempotencyKey,
      created_by: userId,
    });
  }

  private async createIngestionJob(
    tenantId: string,
    spaceId: string,
    userId: string | null,
    document: SourceDocumentRow,
    blob: FileBlobRow,
    priority: number,
    forceNew: boolean,
  ): Promise<JobRow> {
    return JobRepository.create(this.db, {
      tenant_id: tenantId,
      space_id: spaceId,
      queue_name: UPLOAD_JOB_QUEUES.INGESTION,
      type: UPLOAD_JOB_TYPES.INGESTION,
      priority,
      payload_json: {
        source_document_id: document.id,
        archive_uri: blob.storage_uri,
        mime_type: blob.mime_type,
      },
      ...(forceNew ? {} : { idempotency_key: `ingestion:${document.id}:initial` }),
      created_by: userId,
    });
  }

  private async runSecurityValidation(
    document: SourceDocumentRow,
    blob: FileBlobRow,
    buffer: Buffer,
    actorUserId: string | null,
  ): Promise<RecordedValidationPipelineResult> {
    return this.validationPipeline.validateAndRecord({
      sourceDocument: document,
      filename: document.filename,
      declaredMimeType: blob.mime_type,
      buffer,
      actorUserId,
    });
  }

  private async readQuarantineFile(quarantineKey: string): Promise<Buffer> {
    const stream = await this.storageService.download(getBucketName(STORAGE_BUCKET_NAMES.QUARANTINE), quarantineKey);
    return readStream(stream);
  }

  private async toUploadDetail(document: SourceDocumentRow): Promise<UploadDetailDto> {
    const blob = document.file_blob_id === null ? undefined : await this.fileBlobRepository.findById(document.file_blob_id);

    return {
      id: document.id,
      filename: document.filename,
      mime_type: blob?.mime_type ?? null,
      sha256: blob?.sha256 ?? null,
      size_bytes: blob?.size_bytes ?? null,
      source_type: document.source_type,
      classification: document.classification,
      status: document.status,
      uploader_id: document.uploader_id,
      space_id: document.space_id,
      metadata_json: document.metadata_json,
      created_at: document.created_at,
      updated_at: document.updated_at,
    };
  }

  private normalizeMetadata(
    input: CreateUploadDto | undefined,
    options: { batchId: string; sourceUrl?: string },
  ): JsonRecord {
    const parsed = sourceDocumentMetadataSchema.safeParse({
      ...(options.sourceUrl !== undefined ? { source_url: options.sourceUrl } : {}),
      ...(input?.tags !== undefined ? { tags: parseTags(input.tags) } : {}),
      ...(input?.author !== undefined ? { author: input.author.trim() } : {}),
      processing_strategy: input?.processing_strategy ?? 'immediate',
      batch_id: options.batchId,
    });

    if (!parsed.success) {
      throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid upload metadata', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return parsed.data;
  }

  private async assignBatchId(tenantId: string, spaceId: string, now: Date): Promise<string> {
    const recent = await this.sourceDocumentRepository.findRecentBatchId(
      tenantId,
      spaceId,
      new Date(now.getTime() - UPLOAD_BATCH_WINDOW_MS),
    );

    return recent ?? `batch_${randomUUID()}`;
  }

  private async getTenantDocument(sourceDocumentId: string, tenantId: string): Promise<SourceDocumentRow> {
    const document = await this.sourceDocumentRepository.findById(sourceDocumentId);
    if (document === undefined || document.tenant_id !== tenantId) {
      throwApiError(ErrorCode.UPLOAD_NOT_FOUND, 'Upload not found', HttpStatus.NOT_FOUND);
    }

    return document;
  }

  private async requireBlob(fileBlobId: string, tenantId: string): Promise<FileBlobRow> {
    const blob = await this.fileBlobRepository.findById(fileBlobId);
    if (blob === undefined || blob.tenant_id !== tenantId) {
      throwApiError(ErrorCode.UPLOAD_NOT_FOUND, 'File blob not found', HttpStatus.NOT_FOUND);
    }

    return blob;
  }

  private async assertSpaceExists(tenantId: string, spaceId: string): Promise<void> {
    const [space] = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
      .limit(1);

    if (space === undefined) {
      throwApiError(ErrorCode.SPACE_NOT_FOUND, 'Space not found', HttpStatus.NOT_FOUND);
    }
  }

  private async assertSpacePermission(
    tenantId: string,
    userId: string,
    spaceId: string,
    context: UploadContext,
    permissions: string[],
  ): Promise<void> {
    if (hasImplicitSpaceAccess(context.actorRole) || context.actorPermissions?.some((item) => permissions.includes(item)) === true) {
      return;
    }

    const rows = await this.db
      .select({ permission: space_permissions.permission })
      .from(group_members)
      .innerJoin(
        space_permissions,
        and(
          eq(space_permissions.tenant_id, group_members.tenant_id),
          eq(space_permissions.group_id, group_members.group_id),
        ),
      )
      .where(
        and(
          eq(group_members.tenant_id, tenantId),
          eq(group_members.user_id, userId),
          eq(space_permissions.space_id, spaceId),
          inArray(space_permissions.permission, permissions),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throwApiError(ErrorCode.PERMISSION_DENIED, 'Permission denied', HttpStatus.FORBIDDEN);
    }
  }

  private async assertSpacePermissionOrNotFound(
    tenantId: string,
    userId: string,
    spaceId: string,
    context: UploadContext,
    permissions: string[],
  ): Promise<void> {
    try {
      await this.assertSpacePermission(tenantId, userId, spaceId, context, permissions);
    } catch {
      throwApiError(ErrorCode.UPLOAD_NOT_FOUND, 'Upload not found', HttpStatus.NOT_FOUND);
    }
  }

  private async findLatestJobForSourceDocument(tenantId: string, sourceDocumentId: string): Promise<JobRow | undefined> {
    const [job] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenant_id, tenantId), sql`${jobs.payload_json}->>'source_document_id' = ${sourceDocumentId}`))
      .orderBy(desc(jobs.created_at))
      .limit(1);

    return job;
  }

  private async findLatestProgress(jobId: string): Promise<number | null> {
    const [event] = await this.db
      .select()
      .from(job_events)
      .where(and(eq(job_events.job_id, jobId), eq(job_events.event_type, 'progress_updated')))
      .orderBy(desc(job_events.created_at))
      .limit(1);

    if (event === undefined) {
      return null;
    }

    const detail = asJsonRecord(event.detail_json);
    return typeof detail.percent === 'number' && Number.isFinite(detail.percent) ? Math.trunc(detail.percent) : null;
  }
}

function toUploadResponse(
  document: SourceDocumentRow,
  job: JobRow | null,
  created: boolean,
  errorCode?: ErrorCode,
  duplicate?: boolean,
): UploadResponseDto {
  return {
    source_document_id: document.id,
    file_blob_id: document.file_blob_id,
    job_id: job?.id ?? null,
    status: document.status,
    created,
    ...(duplicate === true ? { duplicate: true } : {}),
    ...(errorCode !== undefined ? { error_code: errorCode } : {}),
  };
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throwApiError(ErrorCode.INVALID_URL_FORMAT, 'Invalid URL format', HttpStatus.BAD_REQUEST);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throwApiError(ErrorCode.INVALID_URL_PROTOCOL, 'Only http and https protocols are allowed', HttpStatus.BAD_REQUEST);
  }

  return url;
}

function filenameFromUrl(url: URL): string {
  const pathBase = basename(url.pathname);
  return pathBase.length > 0 && pathBase !== '/' ? pathBase : url.hostname;
}

function priorityForSize(sizeBytes: number): number {
  if (sizeBytes <= SMALL_FILE_MAX_BYTES) {
    return 50;
  }
  if (sizeBytes <= MEDIUM_FILE_MAX_BYTES) {
    return 100;
  }
  return 200;
}

function normalizeContentType(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? 'application/octet-stream' : normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseTags(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
    }
  } catch {
    // Fall through to comma-separated parsing.
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeProcessingStrategy(value: unknown): SourceDocumentProcessingStrategy {
  return value === 'stash' || value === 'archive_only' ? value : 'immediate';
}

function resolveTenantId(context: UploadContext): string {
  if (context.tenantId !== undefined && context.tenantId.trim().length > 0) {
    return context.tenantId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function resolveContextUserId(context: UploadContext): string {
  const userId = context.userId ?? context.actorUserId;
  if (userId !== undefined && userId.trim().length > 0) {
    return userId.trim();
  }

  throwApiError(ErrorCode.UNAUTHENTICATED, 'Unauthenticated', HttpStatus.UNAUTHORIZED);
}

function hasImplicitSpaceAccess(role: string | undefined): boolean {
  return role !== undefined && IMPLICIT_SPACE_ROLES.has(role.trim().toLowerCase());
}

function asJsonRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function clearSecurityRejectionMetadata(value: unknown): JsonRecord {
  const metadata = { ...asJsonRecord(value) };
  delete metadata.rejection_reason;
  delete metadata.rejection_details;
  delete metadata.security_validation;
  return metadata;
}

function readParsedUriFromMetadata(document: SourceDocumentRow): string | undefined {
  const metadata = asJsonRecord(document.metadata_json);
  const parsedUri = metadata.parsed_uri ?? metadata.parsed_md_uri ?? metadata.parsed_markdown_uri;
  return typeof parsedUri === 'string' && parsedUri.trim().length > 0 ? parsedUri : undefined;
}

function isArchiveStorageUri(storageUri: string): boolean {
  const key = storageKeyFromUri(storageUri);
  return storageUri.startsWith('archive/') || key?.startsWith('archive/') === true;
}

function isQuarantineStorageUri(storageUri: string): boolean {
  const key = storageKeyFromUri(storageUri);
  return storageUri.startsWith('quarantine/') || key?.startsWith('quarantine/') === true;
}

function storageKeyFromUri(storageUri: string): string | undefined {
  if (storageUri.startsWith('archive/') || storageUri.startsWith('quarantine/')) {
    return storageUri;
  }

  if (!storageUri.startsWith('s3://')) {
    return undefined;
  }

  const keyStart = storageUri.indexOf('/', 's3://'.length);
  if (keyStart === -1 || keyStart === storageUri.length - 1) {
    return undefined;
  }

  return storageUri.slice(keyStart + 1);
}

function readStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return isRecord(err) && err.code === '23505' && err.constraint === constraint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}

function throwSecurityValidationError(result: RecordedValidationPipelineResult): never {
  if (result.pass) {
    throwApiError(ErrorCode.INTERNAL_ERROR, 'Security validation unexpectedly passed', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  throw new HttpException(
    {
      code: result.code,
      error_code: result.code,
      message: result.reason,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}
