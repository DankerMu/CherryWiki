import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { UploadsController } from './uploads.controller.js';
import { FileBlobRepository, SourceDocumentRepository } from './uploads.repository.js';
import { UploadsService } from './uploads.service.js';
import { MimeValidator } from './validators/mime-validator.js';
import { PromptInjectionScanner } from './validators/prompt-injection-scanner.js';
import { ValidationPipeline } from './validators/validation-pipeline.js';
import { ZipValidator } from './validators/zip-validator.js';

@Module({
  imports: [StorageModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    FileBlobRepository,
    SourceDocumentRepository,
    MimeValidator,
    ZipValidator,
    PromptInjectionScanner,
    ValidationPipeline,
  ],
  exports: [UploadsService, FileBlobRepository, SourceDocumentRepository, ValidationPipeline, PromptInjectionScanner],
})
export class UploadsModule {}
