import { Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { BridgeAuthGuard } from './bridge-auth.guard.js';
import { BridgeEventController } from './bridge-event.controller.js';
import { BridgeEventService } from './bridge-event.service.js';
import { BridgeQueueService } from './bridge-queue.service.js';
import { BridgeRateLimitGuard } from './bridge-rate-limit.guard.js';
import { DocmostBootstrapService } from './docmost-bootstrap.service.js';

const DOCMOST_BOOTSTRAP_RETRY_INTERVAL_MS = 60_000;
const DOCMOST_BOOTSTRAP_MAX_RETRIES = 10;

@Module({
  imports: [AuditModule],
  controllers: [BridgeEventController],
  providers: [
    BridgeAuthGuard,
    BridgeRateLimitGuard,
    BridgeEventService,
    BridgeQueueService,
    DocmostBootstrapService,
  ],
  exports: [BridgeQueueService],
})
export class BridgeModule implements OnApplicationBootstrap, OnModuleDestroy {
  private retryTimer: NodeJS.Timeout | undefined;
  private retryCount = 0;

  constructor(private readonly docmostBootstrapService: DocmostBootstrapService) {}

  async onApplicationBootstrap(): Promise<void> {
    const completed = await this.tryBootstrap();
    if (!completed) {
      this.startRetryTimer();
    }
  }

  onModuleDestroy(): void {
    this.clearRetryTimer();
  }

  private startRetryTimer(): void {
    if (this.retryTimer !== undefined) {
      return;
    }

    this.retryTimer = setInterval(() => {
      void this.runRetry();
    }, DOCMOST_BOOTSTRAP_RETRY_INTERVAL_MS);
  }

  private async runRetry(): Promise<void> {
    this.retryCount += 1;
    const completed = await this.tryBootstrap();
    if (completed || this.retryCount >= DOCMOST_BOOTSTRAP_MAX_RETRIES) {
      this.clearRetryTimer();
    }
  }

  private async tryBootstrap(): Promise<boolean> {
    try {
      return await this.docmostBootstrapService.bootstrapIfNeeded();
    } catch {
      return false;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === undefined) {
      return;
    }

    clearInterval(this.retryTimer);
    this.retryTimer = undefined;
  }
}
