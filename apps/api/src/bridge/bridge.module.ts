import { forwardRef, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { UserModule } from '../users/user.module.js';
import { BridgeAuthGuard } from './bridge-auth.guard.js';
import { BridgeEventController } from './bridge-event.controller.js';
import { BridgeEventService } from './bridge-event.service.js';
import { BridgeQueueService } from './bridge-queue.service.js';
import { BridgeRateLimitGuard } from './bridge-rate-limit.guard.js';
import { DocmostBootstrapService } from './docmost-bootstrap.service.js';

const DOCMOST_BOOTSTRAP_RETRY_INTERVAL_MS = 60_000;
const DOCMOST_BOOTSTRAP_MAX_RETRY_INTERVAL_MS = 300_000;

@Module({
  imports: [AuditModule, forwardRef(() => UserModule)],
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
  private retryDelayMs = DOCMOST_BOOTSTRAP_RETRY_INTERVAL_MS;
  private isBootstrapping = false;
  private isDestroyed = false;

  constructor(private readonly docmostBootstrapService: DocmostBootstrapService) {}

  async onApplicationBootstrap(): Promise<void> {
    const completed = await this.tryBootstrap();
    if (!completed) {
      this.startRetryTimer();
    }
  }

  onModuleDestroy(): void {
    this.isDestroyed = true;
    this.clearRetryTimer();
  }

  private startRetryTimer(): void {
    if (this.isDestroyed) {
      return;
    }

    if (this.retryTimer !== undefined) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      void this.runRetry();
    }, this.retryDelayMs);
  }

  private async runRetry(): Promise<void> {
    this.retryTimer = undefined;
    if (this.isBootstrapping) {
      this.startRetryTimer();
      return;
    }

    this.isBootstrapping = true;
    let completed = false;
    try {
      completed = await this.tryBootstrap();
    } finally {
      this.isBootstrapping = false;
    }

    if (completed) {
      this.retryDelayMs = DOCMOST_BOOTSTRAP_RETRY_INTERVAL_MS;
      return;
    }

    if (this.isDestroyed) {
      return;
    }

    this.retryDelayMs = Math.min(
      this.retryDelayMs * 2,
      DOCMOST_BOOTSTRAP_MAX_RETRY_INTERVAL_MS,
    );
    this.startRetryTimer();
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

    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
}
