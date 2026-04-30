import { Global, Module } from '@nestjs/common';

import { STORAGE_CLIENT, STORAGE_SERVICE } from './storage.constants.js';
import { createStorageClient, StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_CLIENT,
      useFactory: createStorageClient,
    },
    StorageService,
    {
      provide: STORAGE_SERVICE,
      useExisting: StorageService,
    },
  ],
  exports: [StorageService, STORAGE_SERVICE],
})
export class StorageModule {}
