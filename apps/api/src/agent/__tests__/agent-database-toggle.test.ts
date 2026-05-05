import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import type { AuditService } from '../../audit/audit.service.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { createSpaceRow } from '../../users/__tests__/user-group-service-test-utils.js';
import { AgentService, isDatabaseToggleVisible } from '../agent.service.js';
import { AuditCapture } from '../audit-capture.js';
import { ClaudeMdGenerator } from '../claude-md-generator.js';
import { SessionManager } from '../session-manager.js';
import { SettingsGenerator } from '../settings-generator.js';
import { StreamParser } from '../stream-parser.js';
import { AgentTestDb, collectAsync, createMockProcess, writeJsonLine } from './agent-test-utils.js';

const spawnMock = vi.mocked(spawn);
const managers: SessionManager[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('Agent database toggle', () => {
  it('is visible only when the space database_config is enabled', () => {
    expect(isDatabaseToggleVisible(createSpaceRow({ database_config: { enabled: true } }))).toBe(true);
    expect(isDatabaseToggleVisible(createSpaceRow({ database_config: { enabled: false } }))).toBe(false);
    expect(isDatabaseToggleVisible(createSpaceRow({ database_config: {} }))).toBe(false);
  });

  it('injects CHERRY_DB_* env and cherrydb instructions only when database access is enabled', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-db-1');

    const eventsPromise = collectAsync(
      service.spawnNew(conversationId, 'space-1', 'query revenue', {
        enableDatabase: true,
        databaseConfig: {
          enabled: true,
          dsn: 'postgres://readonly:secret@db/internal',
          allowed_tables: ['orders', 'daily_stats'],
          masked_columns: ['orders.credit_card'],
          description: 'Revenue database',
        },
      }),
    );
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'session-db' });
    proc.close(0);
    await eventsPromise;

    const session = service.getSession(conversationId);
    const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
    expect(spawnOptions?.env).toMatchObject({
      CHERRY_DB_DSN: 'postgres://readonly:secret@db/internal',
      CHERRY_DB_ALLOWED_TABLES: 'orders,daily_stats',
      CHERRY_DB_MASKED_COLUMNS: 'orders.credit_card',
    });
    expect(await readFile(join(session?.workDir ?? '', 'CLAUDE.md'), 'utf8')).toContain('cherrydb');
  });

  it('omits database env and instructions when the toggle is off', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc as never);
    const { service } = createService();
    const conversationId = uniqueConversationId('conversation-db-2');

    const eventsPromise = collectAsync(
      service.spawnNew(conversationId, 'space-1', 'query revenue', {
        enableDatabase: false,
        databaseConfig: {
          enabled: true,
          dsn: 'postgres://readonly:secret@db/internal',
          allowed_tables: ['orders'],
          masked_columns: [],
        },
      }),
    );
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    writeJsonLine(proc, { type: 'result', subtype: 'success', session_id: 'session-db-off' });
    proc.close(0);
    await eventsPromise;

    const session = service.getSession(conversationId);
    const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
    expect(spawnOptions?.env).not.toHaveProperty('CHERRY_DB_DSN');
    expect(await readFile(join(session?.workDir ?? '', 'CLAUDE.md'), 'utf8')).not.toContain('cherrydb');
  });
});

function createService(): { service: AgentService; manager: SessionManager } {
  const manager = new SessionManager();
  managers.push(manager);
  const auditService = { push: vi.fn() } as unknown as AuditService;
  const service = new AgentService(
    new AgentTestDb() as unknown as DrizzleDatabase,
    manager,
    new StreamParser(),
    new AuditCapture(auditService),
    new ClaudeMdGenerator(),
    new SettingsGenerator(),
  );

  return { service, manager };
}

function uniqueConversationId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
