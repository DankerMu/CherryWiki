import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { audit_logs } from '@cherrygraph/shared';
import { randomUUID } from 'node:crypto';

import { DRIZZLE } from '../database/drizzle.constants.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { requestContextStorage } from '../common/middleware/request-context.middleware.js';

export interface AuditEntry {
  tenant_id: string;
  actor_user_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  space_id?: string;
  ip?: string;
  user_agent?: string;
  request_id?: string;
  metadata_json?: Record<string, unknown>;
}

type AuditLogInsert = typeof audit_logs.$inferInsert;

type AuditDatabase = {
  insert: (table: typeof audit_logs) => {
    values: (values: AuditLogInsert[]) => Promise<unknown>;
  };
};

type QueuedAuditLogInsert = {
  insert: AuditLogInsert;
  retryCount: number;
};

const AUDIT_FLUSH_INTERVAL_MS = 1_000;
const AUDIT_FLUSH_BATCH_SIZE = 50;
const AUDIT_MAX_QUEUE_SIZE = 10_000;
const AUDIT_MAX_FLUSH_RETRIES = 2;
const AUDIT_METADATA_MAX_DEPTH = 5;
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'jwt',
]);
const SENSITIVE_PREFIXES = ['secret_', 'api_secret'] as const;

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly queue: QueuedAuditLogInsert[] = [];
  private readonly flushTimer: NodeJS.Timeout;
  private flushPromise: Promise<void> | undefined;
  private _retryCount = 0;
  private queueOverflowWarningLogged = false;

  constructor(@Inject(DRIZZLE) private readonly db: AuditDatabase) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, AUDIT_FLUSH_INTERVAL_MS);
  }

  push(entry: AuditEntry): void {
    if (this.queue.length >= AUDIT_MAX_QUEUE_SIZE) {
      this.queue.shift();

      if (!this.queueOverflowWarningLogged) {
        getApiLogger().warn(
          { audit_queue_size: this.queue.length, audit_max_queue_size: AUDIT_MAX_QUEUE_SIZE },
          'Audit queue full; dropped oldest entry',
        );
        this.queueOverflowWarningLogged = true;
      }
    } else {
      this.queueOverflowWarningLogged = false;
    }

    this.queue.push({ insert: toAuditLogInsert(entry), retryCount: 0 });

    if (this.queue.length >= AUDIT_FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushTimer);

    if (this.flushPromise !== undefined) {
      await this.flushPromise;
    }

    while (this.queue.length > 0) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.flushPromise !== undefined) {
      return this.flushPromise;
    }

    this.flushPromise = this.flushQueuedBatches();

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = undefined;
    }
  }

  private async flushQueuedBatches(): Promise<void> {
    do {
      await this.flushQueuedBatch();
    } while (this.queue.length >= AUDIT_FLUSH_BATCH_SIZE);
  }

  private async flushQueuedBatch(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, Math.min(this.queue.length, AUDIT_FLUSH_BATCH_SIZE));
    const insertBatch = batch.map(({ insert }) => insert);

    try {
      await this.db.insert(audit_logs).values(insertBatch);
      this._retryCount = 0;
    } catch (err) {
      this._retryCount = Math.max(0, ...batch.map(({ retryCount }) => retryCount)) + 1;
      const logContext = { err: toSafeLogError(err), audit_log_count: insertBatch.length };

      if (this._retryCount > AUDIT_MAX_FLUSH_RETRIES) {
        getApiLogger().warn({ ...logContext, retry_count: this._retryCount }, 'Audit log batch dropped after retry limit');
        this._retryCount = 0;
        return;
      }

      this.queue.unshift(...batch.map((queuedEntry) => ({ ...queuedEntry, retryCount: this._retryCount })));
      getApiLogger().warn({ ...logContext, retry_count: this._retryCount }, 'Audit log flush failed');
    }
  }
}

function toAuditLogInsert(entry: AuditEntry): AuditLogInsert {
  const requestId = entry.request_id ?? requestContextStorage.getStore()?.request_id;

  return {
    id: randomUUID(),
    tenant_id: entry.tenant_id,
    action: entry.action,
    resource_type: entry.resource_type,
    metadata_json: sanitizeMetadata(entry.metadata_json),
    ...(entry.actor_user_id !== undefined ? { actor_user_id: entry.actor_user_id } : {}),
    ...(entry.resource_id !== undefined ? { resource_id: entry.resource_id } : {}),
    ...(entry.space_id !== undefined ? { space_id: entry.space_id } : {}),
    ...(entry.ip !== undefined ? { ip: entry.ip } : {}),
    ...(entry.user_agent !== undefined ? { user_agent: entry.user_agent } : {}),
    ...(requestId !== undefined ? { request_id: requestId } : {}),
  };
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }

  return sanitizeRecord(metadata, AUDIT_METADATA_MAX_DEPTH, 0);
}

function sanitizeValue(value: unknown, maxDepth = AUDIT_METADATA_MAX_DEPTH, depth = 0): unknown {
  if (depth > maxDepth) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, maxDepth, depth + 1));
  }

  if (isPlainRecord(value)) {
    return sanitizeRecord(value, maxDepth, depth);
  }

  return value;
}

function sanitizeRecord(record: Record<string, unknown>, maxDepth: number, depth: number): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (isSensitiveKey(key) || value === undefined) {
      continue;
    }

    sanitized[key] = sanitizeValue(value, maxDepth, depth + 1);
  }

  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalizedKey) ||
    normalizedKey === 'secret' ||
    SENSITIVE_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
  );
}

function toSafeLogError(err: unknown): { message: string } {
  return { message: err instanceof Error ? err.message : String(err) };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
