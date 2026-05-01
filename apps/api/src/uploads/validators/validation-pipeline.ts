import { Injectable, Optional } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { SourceDocumentRepository, type SourceDocumentRow } from '../uploads.repository.js';

import { MimeValidator, isZipUpload } from './mime-validator.js';
import { PromptInjectionScanner, type PromptInjectionScanResult } from './prompt-injection-scanner.js';
import {
  type SecurityValidationPass,
  type SecurityValidationReject,
  type SecurityValidationResult,
  validationPass,
} from './validation-result.js';
import { ZipValidator } from './zip-validator.js';

export type ValidationPipelineInput = {
  sourceDocument: SourceDocumentRow;
  filename: string;
  declaredMimeType: string;
  buffer: Buffer;
  actorUserId?: string | null;
};

export type ValidationPipelineReject = SecurityValidationReject & {
  sourceDocument: SourceDocumentRow;
};

export type RecordedValidationPipelineResult = SecurityValidationPass | ValidationPipelineReject;

@Injectable()
export class ValidationPipeline {
  constructor(
    private readonly mimeValidator: MimeValidator,
    private readonly zipValidator: ZipValidator,
    private readonly promptInjectionScanner: PromptInjectionScanner,
    private readonly sourceDocumentRepository: SourceDocumentRepository,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async validate(input: Omit<ValidationPipelineInput, 'sourceDocument' | 'actorUserId'>): Promise<SecurityValidationResult> {
    const mimeResult = await this.mimeValidator.validate({
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      buffer: input.buffer,
    });
    if (!mimeResult.pass) {
      return mimeResult;
    }

    if (!isZipUpload(input.filename, mimeResult.details)) {
      return mimeResult;
    }

    const zipResult = await this.zipValidator.validate({
      filename: input.filename,
      buffer: input.buffer,
    });
    if (!zipResult.pass) {
      return zipResult;
    }

    return validationPass({
      ...mimeResult.details,
      zip_validation: zipResult.details,
    });
  }

  async validateAndRecord(input: ValidationPipelineInput): Promise<RecordedValidationPipelineResult> {
    const result = await this.validate({
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      buffer: input.buffer,
    });
    if (result.pass) {
      return result;
    }

    const sourceDocument = await this.rejectSourceDocument(input.sourceDocument, result, input.actorUserId ?? null);
    return {
      ...result,
      sourceDocument,
    };
  }

  scanParsedContent(content: string): PromptInjectionScanResult {
    return this.promptInjectionScanner.scan(content);
  }

  async markPromptInjectionScan(sourceDocument: SourceDocumentRow, parsedMarkdown: string): Promise<SourceDocumentRow> {
    const result = this.scanParsedContent(parsedMarkdown);
    const metadata = this.promptInjectionScanner.applyToMetadata(asJsonRecord(sourceDocument.metadata_json), result);
    return this.sourceDocumentRepository.updateMetadata(sourceDocument.id, metadata);
  }

  private async rejectSourceDocument(
    sourceDocument: SourceDocumentRow,
    result: SecurityValidationReject,
    actorUserId: string | null,
  ): Promise<SourceDocumentRow> {
    const rejectedAt = new Date().toISOString();
    const metadata = {
      ...asJsonRecord(sourceDocument.metadata_json),
      rejection_reason: result.code,
      rejection_details: {
        code: result.code,
        reason: result.reason,
        ...result.details,
      },
      security_validation: {
        passed: false,
        rejected_at: rejectedAt,
        code: result.code,
        reason: result.reason,
        details: result.details,
      },
    };
    const rejected = await this.sourceDocumentRepository.updateStatus(sourceDocument.id, 'security_rejected', {
      metadata_json: metadata,
    });

    this.auditService?.push({
      tenant_id: sourceDocument.tenant_id,
      ...(actorUserId !== null ? { actor_user_id: actorUserId } : {}),
      action: 'upload.security_rejected',
      resource_type: 'source_document',
      resource_id: sourceDocument.id,
      space_id: sourceDocument.space_id,
      metadata_json: {
        code: result.code,
        reason: result.reason,
        filename: sourceDocument.filename,
        details: result.details,
      },
    });

    return rejected;
  }
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
