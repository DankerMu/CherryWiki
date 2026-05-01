import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { UploadsController } from './uploads.controller.js';
import { FileBlobRepository, SourceDocumentRepository } from './uploads.repository.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [StorageModule],
  controllers: [UploadsController],
  providers: [UploadsService, FileBlobRepository, SourceDocumentRepository],
  exports: [UploadsService, FileBlobRepository, SourceDocumentRepository],
})
export class UploadsModule {}
