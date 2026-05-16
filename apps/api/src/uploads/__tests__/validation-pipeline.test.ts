import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it, vi } from 'vitest';

import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import { PromptInjectionScanner } from '../validators/prompt-injection-scanner.js';
import { ValidationPipeline } from '../validators/validation-pipeline.js';
import { MimeValidator } from '../validators/mime-validator.js';
import { ZipValidator } from '../validators/zip-validator.js';
import type { SecurityValidationResult } from '../validators/validation-result.js';
import type { SourceDocumentRepository, SourceDocumentRow } from '../uploads.repository.js';

describe('ValidationPipeline', () => {
  it('passes without running ZIP validation for non-ZIP files', async () => {
    const context = createPipelineContext({
      mimeResult: { pass: true, details: { extension: '.pdf', detected_mime: 'application/pdf' } },
    });

    const result = await context.pipeline.validate({
      filename: 'report.pdf',
      declaredMimeType: 'application/pdf',
      buffer: Buffer.from('pdf'),
    });

    expect(result.pass).toBe(true);
    expect(context.zip.validate).not.toHaveBeenCalled();
  });

  it('records a security rejection and short-circuits when MIME validation fails', async () => {
    const context = createPipelineContext({
      mimeResult: {
        pass: false,
        code: ErrorCode.MIME_MISMATCH,
        reason: 'bad mime',
        details: { detected_mime: 'application/x-elf' },
      },
    });

    const result = await context.pipeline.validateAndRecord({
      sourceDocument: context.sourceDocument,
      filename: 'report.pdf',
      declaredMimeType: 'application/pdf',
      buffer: Buffer.from('bad'),
      actorUserId: 'user-1',
    });

    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.MIME_MISMATCH,
      sourceDocument: {
        status: 'security_rejected',
      },
    });
    expect(context.zip.validate).not.toHaveBeenCalled();
    expect(context.audit.push).toHaveBeenCalledWith(
      expect.objectContaining<Partial<AuditEntry>>({
        action: 'upload.security_rejected',
        resource_id: 'source-1',
      }),
    );
  });

  it('records ZIP rejection after MIME passes', async () => {
    const context = createPipelineContext({
      mimeResult: { pass: true, details: { extension: '.zip', detected_mime: 'application/zip' } },
      zipResult: {
        pass: false,
        code: ErrorCode.ZIP_BOMB_DETECTED,
        reason: 'bomb',
        details: { entry: 'huge.txt' },
      },
    });

    const result = await context.pipeline.validateAndRecord({
      sourceDocument: context.sourceDocument,
      filename: 'bundle.zip',
      declaredMimeType: 'application/zip',
      buffer: Buffer.from('zip'),
      actorUserId: 'user-1',
    });

    expect(context.zip.validate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      pass: false,
      code: ErrorCode.ZIP_BOMB_DETECTED,
      sourceDocument: {
        metadata_json: {
          rejection_reason: ErrorCode.ZIP_BOMB_DETECTED,
        },
      },
    });
  });

  it('passes OOXML files detected as ZIP containers without running ZIP validation', async () => {
    const repository = {
      updateStatus: vi.fn(),
      updateMetadata: vi.fn(),
    };
    const zip = new ZipValidator();
    const zipValidateSpy = vi.spyOn(zip, 'validate');
    const pipeline = new ValidationPipeline(
      new MimeValidator(),
      zip,
      new PromptInjectionScanner(),
      repository as unknown as SourceDocumentRepository,
    );

    const result = await pipeline.validate({
      filename: 'workbook.xlsx',
      declaredMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: minimalZipBuffer(),
    });

    expect(result).toMatchObject({
      pass: true,
      details: {
        extension: '.xlsx',
        detected_mime: 'application/zip',
      },
    });
    expect(zipValidateSpy).not.toHaveBeenCalled();
  });
});

function createPipelineContext(overrides: {
  mimeResult: Awaited<ReturnType<MimeValidator['validate']>>;
  zipResult?: Awaited<ReturnType<ZipValidator['validate']>>;
}): {
  pipeline: ValidationPipeline;
  mime: Pick<MimeValidator, 'validate'>;
  zip: Pick<ZipValidator, 'validate'>;
  sourceDocument: SourceDocumentRow;
  audit: Pick<AuditService, 'push'>;
} {
  const sourceDocument = createSourceDocumentRow();
  const repository = {
    updateStatus: vi.fn((_id: string, status: string, updates: { metadata_json?: Record<string, unknown> } = {}) => {
      sourceDocument.status = status;
      sourceDocument.metadata_json = updates.metadata_json ?? sourceDocument.metadata_json;
      return Promise.resolve(sourceDocument);
    }),
    updateMetadata: vi.fn(),
  };
  const mime = {
    validate: vi.fn(() => Promise.resolve(overrides.mimeResult)),
  };
  const zip = {
    validate: vi.fn((): Promise<SecurityValidationResult> =>
      Promise.resolve(overrides.zipResult ?? { pass: true, details: { entry_count: 1 } }),
    ),
  };
  const audit = {
    push: vi.fn(),
  };
  const pipeline = new ValidationPipeline(
    mime,
    zip as unknown as ZipValidator,
    new PromptInjectionScanner(),
    repository as unknown as SourceDocumentRepository,
    audit as unknown as AuditService,
  );

  return {
    pipeline,
    mime,
    zip,
    sourceDocument,
    audit,
  };
}

function createSourceDocumentRow(): SourceDocumentRow {
  return {
    id: 'source-1',
    tenant_id: 'tenant-1',
    space_id: 'space-1',
    file_blob_id: 'blob-1',
    filename: 'report.pdf',
    uploader_id: 'user-1',
    source_type: 'upload',
    classification: null,
    status: 'validating',
    parsed_uri: null,
    metadata_json: {},
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    updated_at: new Date('2026-04-30T00:00:00.000Z'),
  };
}

function minimalZipBuffer(): Buffer {
  return Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}
