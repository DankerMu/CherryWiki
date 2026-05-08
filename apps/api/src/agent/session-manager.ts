import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, type Dirent } from 'node:fs';
import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  AgentSessionRepository,
  type AgentSessionRow,
  type NewAgentSession,
} from './agent-session.repository.js';
import type {
  AgentRuntimeStatus,
  AgentSessionRecord,
  AgentSpawnOptions,
  OptionsFingerprint,
  PersistentAgentSession,
} from './dto/agent.dto.js';

const DEFAULT_AGENT_ROOT = '/tmp/cherry-agent';
const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_RESIDENT_PROCESSES = 20;
const DEFAULT_SIGNAL_GRACE_MS = 5_000;
const DEFAULT_RETENTION_DAYS = 7;

export const SESSION_MANAGER_CONFIG = Symbol('SESSION_MANAGER_CONFIG');

export type SessionManagerConfig = {
  idleTimeoutMs?: number;
  maxResidentProcesses?: number;
  sigintGraceMs?: number;
  retentionDays?: number;
  instanceId?: string;
  agentRoot?: string;
};

type HasSessionOptions = {
  includePersisted: true;
};

@Injectable()
export class SessionManager implements OnModuleDestroy {
  private readonly sessions = new Map<string, PersistentAgentSession>();
  private readonly persistedSessionIds = new Set<string>();
  private readonly agentRoot: string;
  private idleTimeoutMs: number;
  private maxResidentProcesses: number;
  private sigintGraceMs: number;
  private retentionDays: number;
  private instanceId: string;

  constructor(
    @Optional() private readonly repository?: AgentSessionRepository,
    @Optional()
    @Inject(SESSION_MANAGER_CONFIG)
    config: SessionManagerConfig = {},
  ) {
    this.agentRoot =
      config.agentRoot ?? process.env.CHERRY_AGENT_ROOT ?? process.env.CHERRY_AGENT_TMP_ROOT ?? DEFAULT_AGENT_ROOT;
    this.idleTimeoutMs = config.idleTimeoutMs ?? readPositiveIntegerEnv('AGENT_PROCESS_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS);
    this.maxResidentProcesses =
      config.maxResidentProcesses ??
      readPositiveIntegerEnv('AGENT_MAX_RESIDENT_PROCESSES', DEFAULT_MAX_RESIDENT_PROCESSES);
    this.sigintGraceMs = config.sigintGraceMs ?? readPositiveIntegerEnv('AGENT_SIGINT_GRACE_MS', DEFAULT_SIGNAL_GRACE_MS);
    this.retentionDays = config.retentionDays ?? readPositiveIntegerEnv('AGENT_SESSION_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
    this.instanceId = config.instanceId ?? this.generateInstanceId();
  }

  async getOrCreateSession(
    conversationId: string,
    spaceId: string,
    tenantId: string,
    userId: string,
    options: AgentSpawnOptions = {},
  ): Promise<PersistentAgentSession> {
    const existing = this.sessions.get(conversationId);
    if (existing !== undefined) {
      existing.options = { ...existing.options, ...options };
      existing.optionsFingerprint = this.computeOptionsFingerprint(existing.options);
      return clonePersistentSession(existing);
    }

    const row = await this.repository?.findByConversationId(conversationId);
    if (row !== undefined) {
      this.persistedSessionIds.add(conversationId);
      const restored = await this.restoreSessionFromRow(row, options);
      this.sessions.set(conversationId, restored);
      await this.upsertSession(restored);
      return clonePersistentSession(restored);
    }

    const session = await this.createFreshSession(conversationId, spaceId, tenantId, userId, options);
    this.sessions.set(conversationId, session);
    await this.upsertSession(session);
    return clonePersistentSession(session);
  }

  async attachProcess(conversationId: string, child: ChildProcess): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    this.clearIdleKillTimer(session);
    session.child = child;
    session.status = 'running';
    session.lastActivityAt = Date.now();

    await this.persistStatus(session, {
      process_started_at: new Date(session.lastActivityAt),
      process_stopped_at: null,
    });
    await this.lruEvict();
  }

  async markIdle(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    session.status = 'idle';
    session.lastActivityAt = Date.now();
    this.scheduleIdleKillTimer(session);
    await this.persistStatus(session);
  }

  async markStopped(conversationId: string): Promise<void> {
    await this.stopRuntimeSession(conversationId, 'stopped');
  }

  async markFailed(conversationId: string): Promise<void> {
    await this.stopRuntimeSession(conversationId, 'failed');
  }

  touch(conversationId: string, at = Date.now()): void {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    session.lastActivityAt = at;
    if (session.status === 'idle') {
      this.scheduleIdleKillTimer(session);
    }

    void this.persistTouch(session).catch(() => undefined);
  }

  async close(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session !== undefined) {
      this.clearIdleKillTimer(session);
      session.status = 'stopping';
      const child = session.child;
      session.child = undefined;
      if (isLiveChild(child)) {
        await terminateChild(child, 'SIGTERM', this.sigintGraceMs);
      }

      this.sessions.delete(conversationId);
      this.persistedSessionIds.delete(conversationId);
      await this.deleteSessionDirectories(session.workDir, session.agentHome);
      await this.repository?.delete(conversationId);
      return;
    }

    const row = await this.repository?.findByConversationId(conversationId);
    if (row === undefined) {
      return;
    }

    this.persistedSessionIds.delete(conversationId);
    await this.deleteSessionDirectories(row.work_dir, row.agent_home);
    await this.repository?.delete(conversationId);
  }

  async cleanupAll(): Promise<void> {
    const conversationIds = [...this.sessions.keys()];
    await Promise.all(conversationIds.map((conversationId) => this.close(conversationId)));
  }

  async sweepIdleSessions(now = Date.now()): Promise<string[]> {
    const expired = [...this.sessions.values()]
      .filter((session) => session.status === 'idle' && now - session.lastActivityAt >= this.idleTimeoutMs)
      .map((session) => session.conversationId);

    for (const conversationId of expired) {
      await this.stopRuntimeSession(conversationId, 'stopped', now);
    }

    return expired;
  }

  async lruEvict(): Promise<string[]> {
    const evicted: string[] = [];

    while (this.residentProcessCount() > this.maxResidentProcesses) {
      const candidate = [...this.sessions.values()]
        .filter((session) => session.status === 'idle' && isLiveChild(session.child))
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];

      if (candidate === undefined) {
        break;
      }

      await this.stopRuntimeSession(candidate.conversationId, 'stopped');
      evicted.push(candidate.conversationId);
    }

    return evicted;
  }

  async retentionSweep(now = Date.now()): Promise<string[]> {
    if (this.repository === undefined) {
      return [];
    }

    const olderThan = new Date(now - this.retentionDays * 24 * 60 * 60_000);
    const rows = await this.repository.findStaleForRetentionCleanup(olderThan, ['stopped', 'failed']);
    const deleted: string[] = [];

    for (const row of rows) {
      const session = this.sessions.get(row.conversation_id);
      if (session !== undefined) {
        this.clearIdleKillTimer(session);
        if (isLiveChild(session.child)) {
          await terminateChild(session.child, 'SIGTERM', this.sigintGraceMs);
        }
        this.sessions.delete(row.conversation_id);
      }

      await this.deleteSessionDirectories(row.work_dir, row.agent_home);
      await this.repository.delete(row.conversation_id);
      this.persistedSessionIds.delete(row.conversation_id);
      deleted.push(row.conversation_id);
    }

    return deleted;
  }

  async shutdown(): Promise<void> {
    const now = Date.now();
    const sessions = [...this.sessions.values()];

    await Promise.all(
      sessions.map(async (session) => {
        this.clearIdleKillTimer(session);
        const child = session.child;
        session.child = undefined;

        if (isLiveChild(child)) {
          await terminateChild(child, 'SIGTERM', this.sigintGraceMs);
        }

        if (session.status !== 'stopped' && session.status !== 'failed') {
          session.status = 'stopped';
          session.lastActivityAt = now;
          await this.persistStatus(session, { process_stopped_at: new Date(now) });
        }
      }),
    );
  }

  generateInstanceId(): string {
    const explicitRoot = process.env.CHERRY_AGENT_ROOT ?? process.env.CHERRY_AGENT_TMP_ROOT;
    if (explicitRoot === undefined && this.agentRoot === DEFAULT_AGENT_ROOT) {
      return hostname();
    }

    const instancePath = join(this.agentRoot, '.instance_id');
    try {
      if (existsSync(instancePath)) {
        const existing = readFileSync(instancePath, 'utf8').trim();
        if (existing.length > 0) {
          return existing;
        }
      }

      mkdirSync(this.agentRoot, { recursive: true, mode: 0o700 });
      const generated = randomUUID();
      writeFileSync(instancePath, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
      return generated;
    } catch {
      return hostname();
    }
  }

  computeOptionsFingerprint(options: AgentSpawnOptions = {}): string {
    const fingerprint: OptionsFingerprint = {
      allowedSpaces: [...new Set((options.allowedSpaces ?? []).map((space) => space.id))].sort(),
      graphPaths: [
        ...new Set(
          [
            options.graphBasePath,
            ...(options.allowedSpaces ?? []).map((space) => space.graphPath),
          ].filter(isNonEmptyString),
        ),
      ].sort(),
      databaseEnabled: options.enableDatabase === true && options.databaseConfig?.enabled === true,
      databaseDsn: options.databaseConfig?.dsn,
      model: options.model,
      maxBudgetUsd: options.maxBudgetUsd,
    };

    return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
  }

  hasSession(conversationId: string): boolean;
  hasSession(conversationId: string, options: HasSessionOptions): Promise<boolean>;
  hasSession(conversationId: string, options?: HasSessionOptions): boolean | Promise<boolean> {
    if (options?.includePersisted === true) {
      return this.hasPersistedSession(conversationId);
    }

    return this.sessions.has(conversationId) || this.persistedSessionIds.has(conversationId);
  }

  async hasPersistedSession(conversationId: string): Promise<boolean> {
    if (this.sessions.has(conversationId) || this.persistedSessionIds.has(conversationId)) {
      return true;
    }

    const row = await this.repository?.findByConversationId(conversationId);
    if (row === undefined) {
      return false;
    }

    this.persistedSessionIds.add(conversationId);
    return true;
  }

  size(): number {
    return this.sessions.size;
  }

  configureForTests(input: SessionManagerConfig & { cleanupIntervalMs?: number }): void {
    if (input.idleTimeoutMs !== undefined) {
      this.idleTimeoutMs = input.idleTimeoutMs;
      for (const session of this.sessions.values()) {
        if (session.status === 'idle') {
          this.scheduleIdleKillTimer(session);
        }
      }
    }

    if (input.maxResidentProcesses !== undefined) {
      this.maxResidentProcesses = input.maxResidentProcesses;
      void this.lruEvict().catch(() => undefined);
    }

    if (input.sigintGraceMs !== undefined) {
      this.sigintGraceMs = input.sigintGraceMs;
    }

    if (input.retentionDays !== undefined) {
      this.retentionDays = input.retentionDays;
    }

    if (input.instanceId !== undefined) {
      this.instanceId = input.instanceId;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  setSession(session: AgentSessionRecord): void {
    const persistent = this.toPersistentSession(session);
    const previous = this.sessions.get(session.conversationId);
    if (previous !== undefined) {
      this.clearIdleKillTimer(previous);
    }

    this.sessions.set(session.conversationId, persistent);
    this.persistedSessionIds.add(session.conversationId);

    if (persistent.status === 'idle') {
      this.scheduleIdleKillTimer(persistent);
    }

    void this.upsertSession(persistent).catch(() => undefined);
  }

  getSession(conversationId: string): AgentSessionRecord | undefined {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return undefined;
    }

    return toAgentSessionRecord(session);
  }

  setSessionId(conversationId: string, providerSessionId: string): void {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    session.providerSessionId = providerSessionId;
    session.lastActivityAt = Date.now();
    this.persistedSessionIds.add(conversationId);
    void this.repository?.updateProviderSessionId(conversationId, providerSessionId).catch(() => undefined);
  }

  setProcessRef(conversationId: string, processRef: AgentSessionRecord['processRef']): void {
    if (processRef === undefined) {
      return;
    }

    void this.attachProcess(conversationId, processRef).catch(() => undefined);
  }

  clearProcessRef(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    session.child = undefined;
    void this.markIdle(conversationId).catch(() => undefined);
  }

  private async createFreshSession(
    conversationId: string,
    spaceId: string,
    tenantId: string,
    userId: string,
    options: AgentSpawnOptions,
  ): Promise<PersistentAgentSession> {
    const workDir = join(this.agentRoot, sanitizePathSegment(conversationId));
    const agentHome = join(workDir, '.home');
    await prepareSessionDirectories(workDir, agentHome);

    return {
      conversationId,
      tenantId,
      spaceId,
      userId,
      sessionId: randomUUID(),
      providerSessionId: undefined,
      workDir,
      agentHome,
      status: 'starting',
      child: undefined,
      optionsFingerprint: this.computeOptionsFingerprint(options),
      ownedByInstance: this.instanceId,
      lastActivityAt: Date.now(),
      idleKillTimer: undefined,
      options,
    };
  }

  private async restoreSessionFromRow(
    row: AgentSessionRow,
    options: AgentSpawnOptions,
  ): Promise<PersistentAgentSession> {
    await prepareSessionDirectories(row.work_dir, row.agent_home);

    const ownedByAnotherInstance =
      row.owned_by_instance !== null && row.owned_by_instance !== this.instanceId;
    const restoredStatus = ownedByAnotherInstance
      ? 'stopped'
      : normalizeStoredStatusForRestore(row.status);

    return {
      conversationId: row.conversation_id,
      tenantId: row.tenant_id,
      spaceId: row.space_id,
      userId: row.user_id,
      sessionId: randomUUID(),
      providerSessionId: row.provider_session_id ?? undefined,
      workDir: row.work_dir,
      agentHome: row.agent_home,
      status: restoredStatus,
      child: undefined,
      optionsFingerprint: this.computeOptionsFingerprint(options),
      ownedByInstance: this.instanceId,
      lastActivityAt: row.last_activity_at.getTime(),
      idleKillTimer: undefined,
      options,
    };
  }

  private toPersistentSession(session: AgentSessionRecord): PersistentAgentSession {
    return {
      conversationId: session.conversationId,
      tenantId: session.options.tenantId ?? '',
      spaceId: session.spaceId,
      userId: session.options.userId ?? '',
      sessionId: session.sessionId,
      providerSessionId: undefined,
      workDir: session.workDir,
      agentHome: session.agentHome,
      status: session.processRef === undefined ? 'idle' : 'running',
      child: session.processRef,
      optionsFingerprint: this.computeOptionsFingerprint(session.options),
      ownedByInstance: this.instanceId,
      lastActivityAt: session.lastActivityAt,
      idleKillTimer: undefined,
      options: session.options,
    };
  }

  private async stopRuntimeSession(
    conversationId: string,
    status: Extract<AgentRuntimeStatus, 'stopped' | 'failed'>,
    at = Date.now(),
  ): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    this.clearIdleKillTimer(session);
    const child = session.child;
    session.child = undefined;

    if (isLiveChild(child)) {
      await terminateChild(child, 'SIGTERM', this.sigintGraceMs);
    }

    session.status = status;
    session.lastActivityAt = at;
    await this.persistStatus(session, { process_stopped_at: new Date(at) });
  }

  private async upsertSession(session: PersistentAgentSession): Promise<void> {
    if (this.repository === undefined) {
      return;
    }

    const row: NewAgentSession = {
      conversation_id: session.conversationId,
      tenant_id: session.tenantId,
      space_id: session.spaceId,
      user_id: session.userId,
      provider: 'claude',
      provider_session_id: session.providerSessionId ?? null,
      work_dir: session.workDir,
      agent_home: session.agentHome,
      status: session.status,
      options_hash: session.optionsFingerprint,
      owned_by_instance: session.ownedByInstance,
      last_activity_at: new Date(session.lastActivityAt),
      process_started_at:
        session.status === 'running' && session.child !== undefined
          ? new Date(session.lastActivityAt)
          : null,
      process_stopped_at:
        session.status === 'stopped' || session.status === 'failed'
          ? new Date(session.lastActivityAt)
          : null,
    };

    await this.repository.upsert(row);
    this.persistedSessionIds.add(session.conversationId);
  }

  private async persistStatus(
    session: PersistentAgentSession,
    extra: Partial<AgentSessionRow> = {},
  ): Promise<void> {
    if (this.repository === undefined) {
      return;
    }

    await this.repository.updateStatus(session.conversationId, session.status, {
      provider_session_id: session.providerSessionId ?? null,
      options_hash: session.optionsFingerprint,
      owned_by_instance: session.ownedByInstance,
      last_activity_at: new Date(session.lastActivityAt),
      ...extra,
    });
    this.persistedSessionIds.add(session.conversationId);
  }

  private async persistTouch(session: PersistentAgentSession): Promise<void> {
    if (this.repository === undefined) {
      return;
    }

    await this.repository.updateStatus(session.conversationId, session.status, {
      last_activity_at: new Date(session.lastActivityAt),
      owned_by_instance: session.ownedByInstance,
    });
  }

  private scheduleIdleKillTimer(session: PersistentAgentSession): void {
    this.clearIdleKillTimer(session);
    const remainingMs = Math.max(0, this.idleTimeoutMs - (Date.now() - session.lastActivityAt));
    const timer = setTimeout(() => {
      session.idleKillTimer = undefined;
      void this.sweepIdleSessions().catch(() => undefined);
    }, remainingMs);
    timer.unref();
    session.idleKillTimer = timer;
  }

  private clearIdleKillTimer(session: PersistentAgentSession): void {
    if (session.idleKillTimer === undefined) {
      return;
    }

    clearTimeout(session.idleKillTimer);
    session.idleKillTimer = undefined;
  }

  private residentProcessCount(): number {
    return [...this.sessions.values()].filter((session) => isLiveChild(session.child)).length;
  }

  private async deleteSessionDirectories(workDir: string, agentHome: string): Promise<void> {
    await rm(agentHome, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
    await deleteFailedSiblingDirectories(workDir);
  }
}

function toAgentSessionRecord(session: PersistentAgentSession): AgentSessionRecord {
  return {
    conversationId: session.conversationId,
    spaceId: session.spaceId,
    sessionId: session.providerSessionId ?? session.sessionId,
    workDir: session.workDir,
    agentHome: session.agentHome,
    lastActivityAt: session.lastActivityAt,
    ...(session.child !== undefined ? { processRef: session.child } : {}),
    options: { ...session.options },
  };
}

function clonePersistentSession(session: PersistentAgentSession): PersistentAgentSession {
  return {
    ...session,
    options: { ...session.options },
  };
}

function normalizeStoredStatusForRestore(status: string): AgentRuntimeStatus {
  if (status === 'failed') {
    return 'failed';
  }

  return 'stopped';
}

async function prepareSessionDirectories(workDir: string, agentHome: string): Promise<void> {
  const tmpDir = join(workDir, 'tmp');
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  await mkdir(agentHome, { recursive: true, mode: 0o700 });
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });
  await Promise.all([chmod(workDir, 0o700), chmod(agentHome, 0o700), chmod(tmpDir, 0o700)]);
}

async function terminateChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
  graceMs: number,
): Promise<void> {
  if (!isLiveChild(child)) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      child.off('close', finish);
      child.off('exit', finish);
      child.off('error', finish);
      resolve();
    };

    const timer = setTimeout(() => {
      if (isLiveChild(child)) {
        killChild(child, 'SIGKILL');
      }
      finish();
    }, graceMs);

    child.once('close', finish);
    child.once('exit', finish);
    child.once('error', finish);
    killChild(child, signal);
  });
}

function killChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // The process may already be gone between the liveness check and kill call.
  }
}

function isLiveChild(child: ChildProcess | undefined): child is ChildProcess {
  return child !== undefined && child.exitCode === null;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizePathSegment(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
  return sanitized.length > 0 ? sanitized : randomUUID();
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

async function deleteFailedSiblingDirectories(workDir: string): Promise<void> {
  const parent = dirname(workDir);
  const prefix = `${basename(workDir)}.failed.`;
  let entries: Dirent[];

  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => rm(join(parent, entry.name), { recursive: true, force: true })),
  );
}
