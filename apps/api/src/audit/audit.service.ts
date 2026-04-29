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

const AUDIT_FLUSH_INTERVAL_MS = 1_000;
const AUDIT_FLUSH_BATCH_SIZE = 50;
const SENSITIVE_KEY_PARTS = ['password', 'token', 'secret', 'key'] as const;

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly queue: AuditLogInsert[] = [];
  private readonly flushTimer: NodeJS.Timeout;
  private flushPromise: Promise<void> | undefined;

  constructor(@Inject(DRIZZLE) private readonly db: AuditDatabase) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, AUDIT_FLUSH_INTERVAL_MS);
  }

  push(entry: AuditEntry): void {
    this.queue.push(toAuditLogInsert(entry));

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

    this.flushPromise = this.flushQueuedBatch();

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = undefined;
    }
  }

  private async flushQueuedBatch(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.queue.length);

    try {
      await this.db.insert(audit_logs).values(batch);
    } catch (err) {
      getApiLogger().warn({ err, audit_log_count: batch.length }, 'Audit log flush failed');
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

  return sanitizeRecord(metadata);
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (isPlainRecord(value)) {
    return sanitizeRecord(value);
  }

  return value;
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (isSensitiveKey(key) || value === undefined) {
      continue;
    }

    sanitized[key] = sanitizeValue(value);
  }

  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalizedKey.includes(part));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
