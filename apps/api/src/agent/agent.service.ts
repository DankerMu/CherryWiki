import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { modelUsageLogs } from '@cherrygraph/shared';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { DRIZZLE } from '../database/drizzle.constants.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';
import { AuditCapture } from './audit-capture.js';
import { ClaudeMdGenerator } from './claude-md-generator.js';
import type {
  AgentDatabaseConfig,
  AgentEvent,
  AgentSessionRecord,
  AgentSpawnOptions,
  AgentTiming,
} from './dto/agent.dto.js';
import { SessionManager } from './session-manager.js';
import { SettingsGenerator } from './settings-generator.js';
import { StreamParser } from './stream-parser.js';

const DEFAULT_MAX_CONCURRENT_AGENTS = 20;
const DEFAULT_PROCESS_TIMEOUT_MS = 60 * 60_000;
const HARD_KILL_GRACE_MS = 5_000;
const DEFAULT_MAX_BUDGET_USD = 2;
const DEFAULT_COMMAND = 'claude';
const DEFAULT_INTERNAL_API_URL = 'http://127.0.0.1:3000';
const DEFAULT_AGENT_ROOT = '/tmp/cherry-agent';

@Injectable()
export class AgentService implements OnModuleDestroy {
  private readonly timings = new Map<string, AgentTiming>();
  private activeAgents = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
    private readonly sessionManager: SessionManager,
    private readonly streamParser: StreamParser,
    private readonly auditCapture: AuditCapture,
    private readonly claudeMdGenerator: ClaudeMdGenerator,
    private readonly settingsGenerator: SettingsGenerator,
  ) {}

  async *spawnNew(
    conversationId: string,
    spaceId: string,
    userMessage: string,
    options: AgentSpawnOptions = {},
  ): AsyncGenerator<AgentEvent> {
    const session = await this.prepareSession(conversationId, spaceId, options);

    try {
      yield* this.runClaudeProcess(session, userMessage, { resume: false });
    } catch (err) {
      yield toAgentErrorEvent(err);
    }
  }

  async *resume(
    conversationId: string,
    followUpMessage: string,
    options: AgentSpawnOptions = {},
  ): AsyncGenerator<AgentEvent> {
    const existingSession = this.sessionManager.getSession(conversationId);
    if (existingSession === undefined) {
      yield* this.spawnNew(conversationId, options.allowedSpaces?.[0]?.id ?? conversationId, followUpMessage, options);
      return;
    }

    const mergedSession: AgentSessionRecord = {
      ...existingSession,
      options: { ...existingSession.options, ...options },
    };
    this.sessionManager.setSession(mergedSession);
    this.sessionManager.touch(conversationId);

    let yielded = false;
    try {
      for await (const event of this.runClaudeProcess(mergedSession, followUpMessage, { resume: true })) {
        yielded = true;
        yield event;
      }
    } catch (err) {
      if (yielded || !(err instanceof AgentProcessError)) {
        yield toAgentErrorEvent(err);
        return;
      }

      await rm(join(mergedSession.agentHome, '.claude'), { recursive: true, force: true });
      yield* this.spawnNew(conversationId, mergedSession.spaceId, followUpMessage, mergedSession.options);
    }
  }

  hasSession(conversationId: string): boolean {
    return this.sessionManager.hasSession(conversationId);
  }

  getSession(conversationId: string): AgentSessionRecord | undefined {
    return this.sessionManager.getSession(conversationId);
  }

  getTiming(conversationId: string): AgentTiming | undefined {
    const timing = this.timings.get(conversationId);
    return timing === undefined ? undefined : { ...timing };
  }

  getActiveAgentCount(): number {
    return this.activeAgents;
  }

  getQueuedAgentCount(): number {
    return this.queue.length;
  }

  close(conversationId: string): Promise<void> {
    this.timings.delete(conversationId);
    return this.sessionManager.close(conversationId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.sessionManager.onModuleDestroy();
  }

  private async prepareSession(
    conversationId: string,
    spaceId: string,
    options: AgentSpawnOptions,
  ): Promise<AgentSessionRecord> {
    const workDir = join(process.env.CHERRY_AGENT_TMP_ROOT ?? DEFAULT_AGENT_ROOT, sanitizePathSegment(conversationId));
    const agentHome = join(workDir, '.home');
    const tmpDir = join(workDir, 'tmp');
    const settingsPath = join(workDir, 'settings.json');

    await mkdir(agentHome, { recursive: true });
    await mkdir(tmpDir, { recursive: true });
    const claudeMdInput = {
      spaceId,
      ...(options.allowedSpaces !== undefined ? { allowedSpaces: options.allowedSpaces } : {}),
      ...(options.graphBasePath !== undefined ? { graphBasePath: options.graphBasePath } : {}),
      ...(options.enableDatabase !== undefined ? { enableDatabase: options.enableDatabase } : {}),
      ...(options.databaseConfig !== undefined ? { databaseConfig: options.databaseConfig } : {}),
    };
    const settingsInput = {
      ...(options.model !== undefined ? { model: options.model } : {}),
    };

    await writeFile(join(workDir, 'CLAUDE.md'), this.claudeMdGenerator.generate(claudeMdInput), 'utf8');
    await writeFile(settingsPath, `${JSON.stringify(this.settingsGenerator.generate(settingsInput), null, 2)}\n`, 'utf8');

    const session: AgentSessionRecord = {
      conversationId,
      spaceId,
      sessionId: randomUUID(),
      workDir,
      agentHome,
      lastActivityAt: Date.now(),
      options,
    };
    this.sessionManager.setSession(session);

    return session;
  }

  private async *runClaudeProcess(
    session: AgentSessionRecord,
    userMessage: string,
    input: { resume: boolean },
  ): AsyncGenerator<AgentEvent> {
    await this.acquireSlot(session.options.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT_AGENTS);

    const spawnAt = new Date();
    const timing: AgentTiming = { spawn_at: spawnAt };
    this.timings.set(session.conversationId, timing);

    const args = buildClaudeArgs(session, userMessage, input.resume);
    const env = buildAgentEnv(session);
    const proc = spawn(session.options.command ?? DEFAULT_COMMAND, args, {
      cwd: session.workDir,
      env,
    });

    this.sessionManager.setProcessRef(session.conversationId, proc);
    const exitPromise = waitForProcessExit(proc);
    const usageWrites: Array<Promise<void>> = [];
    const auditContext = {
      tenantId: session.options.tenantId ?? '',
      spaceId: session.spaceId,
      conversationId: session.conversationId,
      ...(session.options.userId !== undefined ? { userId: session.options.userId } : {}),
    };
    const auditPromise = isReadable(proc.stderr)
      ? this.auditCapture.capture(proc.stderr, auditContext)
      : Promise.resolve();
    let hardKillTimer: NodeJS.Timeout | undefined;
    const timeoutMs = session.options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const killTimer = setTimeout(() => {
      proc.kill('SIGTERM');
      hardKillTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill('SIGKILL');
        }
      }, HARD_KILL_GRACE_MS);
    }, timeoutMs);

    try {
      if (!isReadable(proc.stdout)) {
        throw new AgentProcessError('Claude process did not expose stdout');
      }

      for await (const event of this.streamParser.parse(proc.stdout, {
        onSessionId: (sessionId) => {
          this.sessionManager.setSessionId(session.conversationId, sessionId);
        },
        onFirstForwardedEvent: () => {
          const firstSseAt = new Date();
          const current = this.timings.get(session.conversationId) ?? timing;
          if (current.first_sse_at === undefined) {
            current.first_sse_at = firstSseAt;
            this.timings.set(session.conversationId, current);
          }
        },
        onCompleted: (event) => {
          const completedAt = new Date();
          const current = this.timings.get(session.conversationId) ?? timing;
          current.completed_at = completedAt;
          this.timings.set(session.conversationId, current);
          event.latency_ms = completedAt.getTime() - current.spawn_at.getTime();

          if (current.first_sse_at !== undefined) {
            event.first_sse_latency_ms = current.first_sse_at.getTime() - current.spawn_at.getTime();
          }

          usageWrites.push(this.recordModelUsage(session, event).catch(() => undefined));
        },
      })) {
        yield event;
      }

      const exit = await exitPromise;
      if (exit.error !== undefined) {
        throw new AgentProcessError(exit.error.message);
      }

      if (exit.code !== 0) {
        throw new AgentProcessError(`Claude process exited with code ${exit.code ?? 'unknown'}`);
      }
    } finally {
      clearTimeout(killTimer);
      if (hardKillTimer !== undefined) {
        clearTimeout(hardKillTimer);
      }

      this.sessionManager.clearProcessRef(session.conversationId);
      this.releaseSlot();
      await Promise.all(usageWrites);
      await auditPromise.catch(() => undefined);
    }
  }

  private async acquireSlot(maxConcurrentAgents: number): Promise<void> {
    if (this.activeAgents < maxConcurrentAgents) {
      this.activeAgents += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeAgents += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeAgents = Math.max(0, this.activeAgents - 1);
    const next = this.queue.shift();
    if (next !== undefined) {
      next();
    }
  }

  private async recordModelUsage(
    session: AgentSessionRecord,
    event: Extract<AgentEvent, { type: 'message.completed' }>,
  ): Promise<void> {
    if (session.options.tenantId === undefined || session.options.modelConfigId === undefined) {
      return;
    }

    await this.db.insert(modelUsageLogs).values({
      id: randomUUID(),
      tenant_id: session.options.tenantId,
      model_config_id: session.options.modelConfigId,
      request_type: 'agent_deep',
      input_tokens: event.usage?.input_tokens ?? 0,
      output_tokens: event.usage?.output_tokens ?? 0,
      latency_ms: event.latency_ms ?? null,
      space_id: session.spaceId,
      conversation_id: session.conversationId,
      ...(session.options.userId !== undefined ? { user_id: session.options.userId } : {}),
    });
  }
}

export function isDatabaseToggleVisible(space: { database_config?: unknown }): boolean {
  return normalizeDatabaseConfig(space.database_config).enabled;
}

export function normalizeDatabaseConfig(value: unknown): AgentDatabaseConfig {
  if (!isRecord(value)) {
    return { enabled: false };
  }

  return {
    enabled: value.enabled === true,
    ...(typeof value.dsn === 'string' ? { dsn: value.dsn } : {}),
    ...(Array.isArray(value.allowed_tables) ? { allowed_tables: value.allowed_tables.filter(isString) } : {}),
    ...(Array.isArray(value.allowedTables) ? { allowed_tables: value.allowedTables.filter(isString) } : {}),
    ...(Array.isArray(value.masked_columns) ? { masked_columns: value.masked_columns.filter(isString) } : {}),
    ...(Array.isArray(value.maskedColumns) ? { masked_columns: value.maskedColumns.filter(isString) } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
  };
}

function buildClaudeArgs(session: AgentSessionRecord, userMessage: string, resume: boolean): string[] {
  const args = ['--print'];
  if (resume) {
    args.push('--resume', session.sessionId);
  } else {
    args.push('--session-id', session.sessionId);
  }

  args.push(
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--tools',
    'Bash,Read',
    '--permission-mode',
    'bypassPermissions',
    '--settings',
    join(session.workDir, 'settings.json'),
    '--max-budget-usd',
    String(session.options.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD),
    '-p',
    userMessage,
  );

  return args;
}

function buildAgentEnv(session: AgentSessionRecord): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    HOME: session.agentHome,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TMPDIR: join(session.workDir, 'tmp'),
    CHERRY_API_INTERNAL_URL:
      session.options.apiInternalUrl ?? process.env.CHERRY_API_INTERNAL_URL ?? DEFAULT_INTERNAL_API_URL,
  };
  const apiKey = process.env.AGENT_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const baseUrl = process.env.AGENT_ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
  const model = session.options.model ?? process.env.AGENT_ANTHROPIC_MODEL ?? process.env.ANTHROPIC_MODEL;
  const token = session.options.agentToken ?? process.env.CHERRY_AGENT_TOKEN;

  if (apiKey !== undefined && apiKey.length > 0) {
    env.ANTHROPIC_API_KEY = apiKey;
  }

  if (baseUrl !== undefined && baseUrl.length > 0) {
    env.ANTHROPIC_BASE_URL = baseUrl;
  }

  if (model !== undefined && model.length > 0) {
    env.ANTHROPIC_MODEL = model;
  }

  if (token !== undefined && token.length > 0) {
    env.CHERRY_AGENT_TOKEN = token;
  }

  const databaseConfig = session.options.databaseConfig;
  if (session.options.enableDatabase === true && databaseConfig?.enabled === true) {
    if (databaseConfig.dsn !== undefined) {
      env.CHERRY_DB_DSN = databaseConfig.dsn;
    }

    if (databaseConfig.allowed_tables !== undefined) {
      env.CHERRY_DB_ALLOWED_TABLES = databaseConfig.allowed_tables.join(',');
    }

    if (databaseConfig.masked_columns !== undefined) {
      env.CHERRY_DB_MASKED_COLUMNS = databaseConfig.masked_columns.join(',');
    }
  }

  return env;
}

function waitForProcessExit(proc: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }> {
  return new Promise((resolve) => {
    proc.once('error', (error) => {
      resolve({ code: null, signal: null, error });
    });
    proc.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

function isReadable(value: unknown): value is Readable {
  return value !== null && value !== undefined && typeof (value as Readable).pipe === 'function';
}

function toAgentErrorEvent(err: unknown): Extract<AgentEvent, { type: 'message.error' }> {
  return {
    type: 'message.error',
    code: err instanceof AgentProcessError ? 'process_error' : 'internal_error',
    message: err instanceof Error ? err.message : String(err),
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

class AgentProcessError extends Error {}
