import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { AuditCapture } from '../audit-capture.js';

void spawn;

describe('AuditCapture', () => {
  it('parses cherrydb stderr JSON and writes database_query audit entries', async () => {
    const push = vi.fn<(entry: AuditEntry) => void>();
    const capture = new AuditCapture({ push } as unknown as AuditService);
    const stderr = new PassThrough();
    const capturePromise = capture.capture(stderr, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      spaceId: 'space-1',
      conversationId: 'conversation-1',
    });

    stderr.write(
      `${JSON.stringify({
        event: 'database_query',
        sql: 'SELECT * FROM orders',
        row_count: 12,
        duration_ms: 230,
        timestamp: '2026-05-05T10:30:00Z',
      })}\n`,
    );
    stderr.end();
    await capturePromise;

    expect(push).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      actor_user_id: 'user-1',
      action: 'database_query',
      resource_type: 'sql',
      space_id: 'space-1',
      metadata_json: {
        event: 'database_query',
        sql: 'SELECT * FROM orders',
        row_count: 12,
        duration_ms: 230,
        timestamp: '2026-05-05T10:30:00Z',
        conversation_id: 'conversation-1',
      },
    });
  });

  it('ignores non-JSON lines and unrelated JSON events', async () => {
    const push = vi.fn<(entry: AuditEntry) => void>();
    const capture = new AuditCapture({ push } as unknown as AuditService);
    const stderr = new PassThrough();
    const capturePromise = capture.capture(stderr, { tenantId: 'tenant-1' });

    stderr.write('Claude warning line\n');
    stderr.write(`${JSON.stringify({ event: 'debug', message: 'not an audit event' })}\n`);
    stderr.end();
    await capturePromise;

    expect(push).not.toHaveBeenCalled();
  });
});
