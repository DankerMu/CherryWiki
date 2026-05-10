import { HttpException, HttpStatus, Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { modelUsageLogs } from '@cherrygraph/shared';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chown, chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { DRIZZLE } from '../database/drizzle.constants.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';
import { collectAgentGraphPaths } from './agent-graph-paths.js';
import { AuditCapture } from './audit-capture.js';
import { ClaudeMdGenerator } from './claude-md-generator.js';
import type {
  AgentDatabaseConfig,
  AgentEvent,
  AgentSessionRecord,
  AgentSpawnOptions,
  AgentTiming,
  PersistentAgentSession,
} from './dto/agent.dto.js';
import { PersistentStreamParser } from './persistent-stream-parser.js';
import { SessionMutex } from './session-mutex.js';
import { SessionManager } from './session-manager.js';
import { SettingsGenerator } from './settings-generator.js';
import { StreamParser } from './stream-parser.js';
import type { TurnEventQueue } from './turn-event-queue.js';

const DEFAULT_MAX_CONCURRENT_AGENTS = 20;
const DEFAULT_PROCESS_TIMEOUT_MS = 60 * 60_000;
const HARD_KILL_GRACE_MS = 5_000;
const MAX_QUEUE_SIZE = 50;
const DEFAULT_MAX_BUDGET_USD = 2;
const DEFAULT_COMMAND = 'claude';
const DEFAULT_INTERNAL_API_URL = 'http://127.0.0.1:3000';
const DEFAULT_AGENT_ROOT = '/tmp/cherry-agent';
const AGENT_UID = readPositiveIntegerEnv('AGENT_SPAWN_UID', process.getuid?.() === 0 ? 10001 : 0);
const AGENT_GID = readPositiveIntegerEnv('AGENT_SPAWN_GID', process.getuid?.() === 0 ? 10001 : 0);

if (AGENT_UID > 0) {
  try {
    execFileSync('which', ['setpriv'], { stdio: 'ignore' });
  } catch {
    console.error(
      `[AgentService] FATAL: setpriv is required when AGENT_SPAWN_UID (${AGENT_UID}) > 0 but was not found on PATH. ` +
      'Install util-linux or equivalent package.',
    );
    process.exit(1);
  }
}

type HasSessionOptions = {
  includePersisted: true;
};

export class AgentSessionBusyError extends Error {
  constructor(conversationId: string) {
    super(`Agent session ${conversationId} is busy with another turn`);
    this.name = 'AgentSessionBusyError';
  }
}

@Injectable()
export class AgentService implements OnModuleDestroy {
  private readonly timings = new Map<string, AgentTiming>();
  private activeAgents = 0;
  private readonly queue: Array<() => void> = [];
  private readonly persistentParsers = new Map<string, PersistentStreamParser>();
  private readonly persistentSlotHolders = new Set<string>();
  private readonly turnMutex = new SessionMutex();

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
    let usefulContentReceived = false;
    let resumeFailureEvent: Extract<AgentEvent, { type: 'message.error' }> | undefined;
    try {
      for await (const event of this.runClaudeProcess(mergedSession, followUpMessage, { resume: true })) {
        if (event.type === 'message.delta') {
          usefulContentReceived = true;
        }

        if (event.type === 'message.error' && !usefulContentReceived && isResumeSessionError(event)) {
          resumeFailureEvent = event;
          continue;
        }

        yielded = true;
        yield event;
      }

      if (resumeFailureEvent !== undefined && !usefulContentReceived) {
        await rm(join(mergedSession.agentHome, '.claude'), { recursive: true, force: true });
        yield* this.spawnNew(conversationId, mergedSession.spaceId, followUpMessage, mergedSession.options);
      }
    } catch (err) {
      if (resumeFailureEvent !== undefined && !usefulContentReceived) {
        await rm(join(mergedSession.agentHome, '.claude'), { recursive: true, force: true });
        yield* this.spawnNew(conversationId, mergedSession.spaceId, followUpMessage, mergedSession.options);
        return;
      }

      if (yielded || !(err instanceof AgentProcessError)) {
        yield toAgentErrorEvent(err);
        return;
      }

      await rm(join(mergedSession.agentHome, '.claude'), { recursive: true, force: true });
      yield* this.spawnNew(conversationId, mergedSession.spaceId, followUpMessage, mergedSession.options);
    }
  }

  hasSession(conversationId: string): boolean;
  hasSession(conversationId: string, options: HasSessionOptions): Promise<boolean>;
  hasSession(conversationId: string, options?: HasSessionOptions): boolean | Promise<boolean> {
    if (options?.includePersisted === true) {
      return this.sessionManager.hasSession(conversationId, options);
    }

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

    await mkdir(workDir, { recursive: true, mode: 0o700 });
    await chmod(workDir, 0o700);
    await mkdir(agentHome, { recursive: true, mode: 0o700 });
    await mkdir(tmpDir, { recursive: true, mode: 0o700 });
    await Promise.all([chmod(agentHome, 0o700), chmod(tmpDir, 0o700)]);
    if (AGENT_UID > 0) {
      await Promise.all([chown(workDir, AGENT_UID, AGENT_GID || AGENT_UID), chown(agentHome, AGENT_UID, AGENT_GID || AGENT_UID), chown(tmpDir, AGENT_UID, AGENT_GID || AGENT_UID)]);
    }

    const session: AgentSessionRecord = {
      conversationId,
      spaceId,
      sessionId: randomUUID(),
      workDir,
      agentHome,
      lastActivityAt: Date.now(),
      options,
    };
    await this.writeRuntimeFiles(session);
    this.sessionManager.setSession(session);

    return session;
  }

  async spawnPersistentProcess(session: PersistentAgentSession): Promise<void> {
    const attemptedResumeSessionId = getNonEmptyString(session.providerSessionId);

    try {
      await this.spawnPersistentProcessOnce(session);
      return;
    } catch (err) {
      if (attemptedResumeSessionId === undefined) {
        throw err;
      }

      await this.recoverFromPersistentResumeFailure(session);
      await this.spawnPersistentProcessOnce(session);
    }
  }

  private async spawnPersistentProcessOnce(session: PersistentAgentSession): Promise<void> {
    const existing = session.child;
    if (isLiveProcess(existing) && this.persistentParsers.has(session.conversationId)) {
      return;
    }

    await this.acquireSlot(session.options.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT_AGENTS);
    this.persistentSlotHolders.add(session.conversationId);

    let proc: ChildProcess | undefined;
    let trackedExitPromise: Promise<ProcessExit> | undefined;
    try {
      await this.writeRuntimeFiles(session);
      const args = buildPersistentClaudeArgs(session);
      const env = buildAgentEnv(session);
      const command = session.options.command ?? DEFAULT_COMMAND;
      const spawnCmd = AGENT_UID > 0 ? 'setpriv' : command;
      const spawnArgs = AGENT_UID > 0
        ? [`--reuid=${AGENT_UID}`, `--regid=${AGENT_GID || AGENT_UID}`, '--clear-groups', command, ...args]
        : args;
      proc = spawn(spawnCmd, spawnArgs, {
        cwd: session.workDir,
        env,
      });
      const processExitPromise = waitForProcessExit(proc);

      if (!isReadable(proc.stdout)) {
        throw new AgentProcessError('Claude process did not expose stdout');
      }

      if (!isWritable(proc.stdin)) {
        throw new AgentProcessError('Claude process did not expose stdin');
      }

      const parser = new PersistentStreamParser();
      const auditContext = buildAuditContext(session);
      const auditPromise = isReadable(proc.stderr)
        ? this.auditCapture.capture(proc.stderr, auditContext)
        : Promise.resolve();

      await this.sessionManager.attachProcess(session.conversationId, proc);
      session.child = proc;
      session.status = 'running';
      session.lastActivityAt = Date.now();

      parser.startReading(proc.stdout, {
        onSessionId: (providerSessionId) => {
          session.providerSessionId = providerSessionId;
          this.sessionManager.setSessionId(session.conversationId, providerSessionId);
        },
      });
      this.persistentParsers.set(session.conversationId, parser);

      trackedExitPromise = this.trackPersistentExit(session.conversationId, processExitPromise, parser, auditPromise);

      // Give the event loop a short grace window so an immediate process
      // exit (e.g. a stale --resume session) propagates before we return.
      await this.checkEarlyProcessExit(proc, processExitPromise);
    } catch (err) {
      this.persistentParsers.get(session.conversationId)?.stop();
      this.persistentParsers.delete(session.conversationId);

      if (proc !== undefined && proc.exitCode === null) {
        proc.kill('SIGTERM');
      }

      if (trackedExitPromise !== undefined) {
        await Promise.race([
          trackedExitPromise.catch(() => undefined),
          delay(readPositiveIntegerEnv('AGENT_SIGINT_GRACE_MS', HARD_KILL_GRACE_MS)),
        ]);
      }

      this.releasePersistentSlot(session.conversationId);
      await this.sessionManager.markFailed(session.conversationId);

      throw err;
    }
  }

  private async checkEarlyProcessExit(
    proc: ChildProcess,
    exitPromise: Promise<ProcessExit>,
  ): Promise<void> {
    // Race the exit promise against a short grace period.
    // If the process dies immediately (e.g. a stale --resume session),
    // the exit promise wins and we throw, allowing resume-failure recovery.
    const graceMs = readPositiveIntegerEnv(
      'AGENT_EARLY_EXIT_GRACE_MS',
      50,
    );
    const result = await Promise.race([
      exitPromise.then((exit) => ({ type: 'exit' as const, exit })),
      delay(graceMs).then(() => ({ type: 'alive' as const })),
    ]);
    if (result.type === 'exit') {
      const { exit } = result;
      if (exit.error !== undefined) {
        throw new AgentProcessError(exit.error.message);
      }
      throw new AgentProcessError(
        `Claude process exited immediately with code ${exit.code ?? 'unknown'}`,
      );
    }
  }

  async *sendTurn(
    conversationId: string,
    spaceId: string,
    userMessage: string,
    options: AgentSpawnOptions = {},
  ): AsyncGenerator<AgentEvent> {
    const tenantId = options.tenantId ?? '';
    const userId = options.userId ?? '';
    const inMemorySession = this.sessionManager.getSession(conversationId);
    if (
      inMemorySession !== undefined &&
      ((inMemorySession.options.tenantId ?? '') !== tenantId ||
        (inMemorySession.options.userId ?? '') !== userId)
    ) {
      yield agentSessionScopeMismatchEvent();
      return;
    }

    const releaseTurn = this.turnMutex.tryAcquire(conversationId);
    if (releaseTurn === null) {
      throw new AgentSessionBusyError(conversationId);
    }

    try {
      const session = await this.sessionManager.getOrCreateSession(
        conversationId,
        spaceId,
        tenantId,
        userId,
        options,
      );
      if (session === undefined) {
        yield agentSessionScopeMismatchEvent();
        return;
      }

      const refreshedSession = await this.refreshConfigIfNeeded(session, options);

      const needsSpawn =
        !isLiveProcess(refreshedSession.child) ||
        refreshedSession.status === 'starting' ||
        refreshedSession.status === 'stopped' ||
        refreshedSession.status === 'failed';

      if (needsSpawn) {
        await this.spawnPersistentProcess(refreshedSession);
      }

      yield* this.sendTurnToPersistentProcessLocked(refreshedSession, userMessage);
    } finally {
      releaseTurn();
    }
  }

  async *sendTurnToPersistentProcess(
    session: PersistentAgentSession,
    userMessage: string,
  ): AsyncGenerator<AgentEvent> {
    const releaseTurn = this.turnMutex.tryAcquire(session.conversationId);
    if (releaseTurn === null) {
      yield {
        type: 'message.error',
        code: 'agent_session_busy',
        message: 'Agent session is already running',
      };
      return;
    }

    try {
      yield* this.sendTurnToPersistentProcessLocked(session, userMessage);
    } finally {
      releaseTurn();
    }
  }

  private async *sendTurnToPersistentProcessLocked(
    session: PersistentAgentSession,
    userMessage: string,
  ): AsyncGenerator<AgentEvent> {
    const usageWrites: Array<Promise<void>> = [];
    let turn: TurnEventQueue | undefined;
    let turnStreamFinished = false;
    let terminalEventSeen = false;
    let firstTurnAttempted = false;

    try {
      if (!isLiveProcess(session.child) || !this.persistentParsers.has(session.conversationId)) {
        await this.spawnPersistentProcess(session);
      }

      const parser = this.persistentParsers.get(session.conversationId);
      const proc = session.child;
      if (parser === undefined || !isLiveProcess(proc) || !isWritable(proc.stdin)) {
        throw new AgentProcessError('Claude persistent process is not available');
      }

      // Create the turn queue BEFORE writing to stdin so that events
      // emitted immediately (including system/init) are captured.
      turn = parser.createTurn();
      await this.sessionManager.attachProcess(session.conversationId, proc);
      session.status = 'running';
      session.child = proc;

      const timing: AgentTiming = { spawn_at: new Date() };
      this.timings.set(session.conversationId, timing);
      let firstForwardedEventSeen = false;

      firstTurnAttempted = true;
      await writePersistentTurn(proc.stdin, userMessage);

      for await (const event of turn) {
        if (!firstForwardedEventSeen) {
          firstForwardedEventSeen = true;
          timing.first_sse_at = new Date();
          this.timings.set(session.conversationId, timing);
        }

        if (this.handlePersistentTerminalEvent(session, event, timing, usageWrites)) {
          terminalEventSeen = true;
          await this.finishPersistentTurn(session);
        }

        yield event;
      }

      turnStreamFinished = true;

      if (!terminalEventSeen && !isLiveProcess(session.child)) {
        yield {
          type: 'message.error',
          code: 'process_exited',
          message: 'Claude process exited before completing the turn',
        };
      }
    } catch (err) {
      turnStreamFinished = true;
      if (turn !== undefined && !terminalEventSeen) {
        this.persistentParsers.get(session.conversationId)?.cancelActiveTurn();
      }

      const proc = session.child;
      if (isLiveProcess(proc)) {
        await this.sessionManager.markIdle(session.conversationId);
      } else if (
        !firstTurnAttempted &&
        getNonEmptyString(session.providerSessionId) !== undefined
      ) {
        try {
          await this.recoverFromPersistentResumeFailure(session);
          await this.spawnPersistentProcess(session);
          yield* this.sendTurnToPersistentProcessLocked(session, userMessage);
          return;
        } catch {
          await this.sessionManager.markFailed(session.conversationId);
        }
      } else {
        await this.sessionManager.markFailed(session.conversationId);
      }

      yield toAgentErrorEvent(err);
    } finally {
      if (turn !== undefined && !turnStreamFinished && !terminalEventSeen) {
        await this.cancelPersistentTurn(session, turn);
      }

      await Promise.all(usageWrites);
    }
  }

  private async refreshConfigIfNeeded(
    session: PersistentAgentSession,
    options: AgentSpawnOptions,
  ): Promise<PersistentAgentSession> {
    const mergedOptions = { ...session.options, ...options };
    const nextFingerprint = this.sessionManager.computeOptionsFingerprint(mergedOptions);
    const fingerprintChanged = session.optionsFingerprint !== nextFingerprint;
    const refreshedSession: PersistentAgentSession = {
      ...session,
      options: mergedOptions,
      optionsFingerprint: nextFingerprint,
    };

    await this.writeRuntimeFiles(refreshedSession);

    if (fingerprintChanged && isLiveProcess(session.child)) {
      if (session.status !== 'idle') {
        throw new AgentSessionBusyError(session.conversationId);
      }

      await this.stopPersistentProcessForRestart(session);
      refreshedSession.child = undefined;
      refreshedSession.status = 'stopped';
    }

    return (
      (await this.sessionManager.updateRuntimeConfig(
        session.conversationId,
        mergedOptions,
        nextFingerprint,
      )) ?? refreshedSession
    );
  }

  private async stopPersistentProcessForRestart(session: PersistentAgentSession): Promise<void> {
    this.persistentParsers.get(session.conversationId)?.stop();
    this.persistentParsers.delete(session.conversationId);
    await this.sessionManager.markStopped(session.conversationId);
    this.releasePersistentSlot(session.conversationId);
    session.child = undefined;
    session.status = 'stopped';
  }

  private async recoverFromPersistentResumeFailure(session: PersistentAgentSession): Promise<void> {
    this.persistentParsers.get(session.conversationId)?.stop();
    this.persistentParsers.delete(session.conversationId);
    this.releasePersistentSlot(session.conversationId);

    const recovered = await this.sessionManager.resetAfterResumeFailure(session.conversationId);
    if (recovered === undefined) {
      throw new AgentProcessError('Unable to reset Agent session after resume failure');
    }

    Object.assign(session, recovered);
  }

  private handlePersistentTerminalEvent(
    session: PersistentAgentSession,
    event: AgentEvent,
    timing: AgentTiming,
    usageWrites: Array<Promise<void>>,
  ): boolean {
    if (event.type === 'message.completed') {
      const completedAt = new Date();
      timing.completed_at = completedAt;
      event.latency_ms = completedAt.getTime() - timing.spawn_at.getTime();

      if (timing.first_sse_at !== undefined) {
        event.first_sse_latency_ms = timing.first_sse_at.getTime() - timing.spawn_at.getTime();
      }

      usageWrites.push(this.recordModelUsage(session, event).catch(() => undefined));
      return true;
    }

    return event.type === 'message.error';
  }

  private async finishPersistentTurn(session: PersistentAgentSession): Promise<void> {
    if (!isLiveProcess(session.child)) {
      await this.sessionManager.markFailed(session.conversationId);
      return;
    }

    await this.sessionManager.markIdle(session.conversationId);
    session.status = 'idle';
    session.lastActivityAt = Date.now();
    this.sessionManager.touch(session.conversationId, session.lastActivityAt);
  }

  private async cancelPersistentTurn(
    session: PersistentAgentSession,
    turn: TurnEventQueue,
  ): Promise<void> {
    const proc = session.child;
    const parser = this.persistentParsers.get(session.conversationId);
    if (!isLiveProcess(proc)) {
      parser?.cancelActiveTurn();
      return;
    }

    const turnSettled = turn.waitUntilSettled().then(
      () => ({ type: 'turn' as const }),
      () => ({ type: 'turn' as const }),
    );
    const processExited = waitForProcessExit(proc).then(() => ({ type: 'exit' as const }));
    const graceMs = readPositiveIntegerEnv('AGENT_SIGINT_GRACE_MS', HARD_KILL_GRACE_MS);

    proc.kill('SIGINT');

    const outcome = await Promise.race([
      turnSettled,
      processExited,
      delay(graceMs).then(() => ({ type: 'timeout' as const })),
    ]);

    if (outcome.type === 'turn') {
      if (isLiveProcess(proc)) {
        await this.finishPersistentTurn(session);
      }
      return;
    }

    if (outcome.type === 'exit' || !isLiveProcess(proc)) {
      return;
    }

    const exitedAfterKill = waitForProcessCloseOrTimeout(proc, graceMs);
    proc.kill('SIGKILL');

    if (await exitedAfterKill) {
      return;
    }

    parser?.cancelActiveTurn();
    parser?.stop();
    this.persistentParsers.delete(session.conversationId);
    await this.sessionManager.markFailed(session.conversationId);
    this.releasePersistentSlot(session.conversationId);
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
    const legacyCmd = session.options.command ?? DEFAULT_COMMAND;
    const legacySpawnCmd = AGENT_UID > 0 ? 'setpriv' : legacyCmd;
    const legacySpawnArgs = AGENT_UID > 0
      ? [`--reuid=${AGENT_UID}`, `--regid=${AGENT_GID || AGENT_UID}`, '--clear-groups', legacyCmd, ...args]
      : args;
    const proc = spawn(legacySpawnCmd, legacySpawnArgs, {
      cwd: session.workDir,
      env,
    });

    this.sessionManager.setProcessRef(session.conversationId, proc);
    let processClosed = false;
    const exitPromise = waitForProcessExit(proc).then((exit) => {
      processClosed = true;
      return exit;
    });
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

      if (!processClosed && proc.exitCode === null) {
        await terminateProcess(proc);
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

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      throw new HttpException('Agent queue full, try again later', HttpStatus.SERVICE_UNAVAILABLE);
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

  private releasePersistentSlot(conversationId: string): void {
    if (!this.persistentSlotHolders.delete(conversationId)) {
      return;
    }

    this.releaseSlot();
  }

  private trackPersistentExit(
    conversationId: string,
    processExitPromise: Promise<ProcessExit>,
    parser: PersistentStreamParser,
    auditPromise: Promise<void>,
  ): Promise<ProcessExit> {
    return processExitPromise
      .then(async (exit) => {
        const stillCurrentParser = this.persistentParsers.get(conversationId) === parser;
        parser.stop();

        if (stillCurrentParser) {
          this.persistentParsers.delete(conversationId);

          if (exit.error !== undefined || exit.code !== 0) {
            await this.sessionManager.markFailed(conversationId);
          } else {
            await this.sessionManager.markStopped(conversationId);
          }

          this.releasePersistentSlot(conversationId);
        }

        await auditPromise.catch(() => undefined);
        return exit;
      })
      .catch(async (err: unknown) => {
        const stillCurrentParser = this.persistentParsers.get(conversationId) === parser;
        parser.stop();
        if (stillCurrentParser) {
          this.persistentParsers.delete(conversationId);
          await this.sessionManager.markFailed(conversationId);
          this.releasePersistentSlot(conversationId);
        }
        await auditPromise.catch(() => undefined);
        return { code: null, signal: null, error: toError(err) };
      });
  }

  private async writeRuntimeFiles(
    session: Pick<AgentSessionRecord, 'workDir' | 'spaceId' | 'options'>,
  ): Promise<void> {
    const claudeMdInput = {
      spaceId: session.spaceId,
      ...(session.options.allowedSpaces !== undefined ? { allowedSpaces: session.options.allowedSpaces } : {}),
      ...(session.options.graphBasePath !== undefined ? { graphBasePath: session.options.graphBasePath } : {}),
      ...(session.options.enableDatabase !== undefined ? { enableDatabase: session.options.enableDatabase } : {}),
      ...(session.options.databaseConfig !== undefined ? { databaseConfig: session.options.databaseConfig } : {}),
    };

    const claudeMdPath = join(session.workDir, 'CLAUDE.md');
    const settingsPath = join(session.workDir, 'settings.json');
    await writeFileExclusive(claudeMdPath, this.claudeMdGenerator.generate(claudeMdInput), AGENT_UID, AGENT_GID);
    await writeFileExclusive(
      settingsPath,
      `${JSON.stringify(
        this.settingsGenerator.generate({
          workDir: session.workDir,
          graphPaths: collectAgentGraphPaths(claudeMdInput),
        }),
        null,
        2,
      )}\n`,
      AGENT_UID,
      AGENT_GID,
    );
  }

  private async recordModelUsage(
    session: AgentSessionRecord,
    event: Extract<AgentEvent, { type: 'message.completed' }>,
  ): Promise<void> {
    if (session.options.tenantId === undefined) {
      return;
    }

    const modelConfigId = session.options.agentModelConfigId ?? session.options.modelConfigId ?? 'agent-default';

    await this.db.insert(modelUsageLogs).values({
      id: randomUUID(),
      tenant_id: session.options.tenantId,
      model_config_id: modelConfigId,
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

function buildPersistentClaudeArgs(session: PersistentAgentSession): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
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
  ];

  if (session.providerSessionId !== undefined && session.providerSessionId.length > 0) {
    args.push('--resume', session.providerSessionId);
  } else {
    args.push('--session-id', session.sessionId);
  }

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

function buildAuditContext(session: Pick<PersistentAgentSession, 'conversationId' | 'spaceId' | 'options'>) {
  return {
    tenantId: session.options.tenantId ?? '',
    spaceId: session.spaceId,
    conversationId: session.conversationId,
    ...(session.options.userId !== undefined ? { userId: session.options.userId } : {}),
  };
}

type ProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

function waitForProcessExit(proc: ChildProcess): Promise<ProcessExit> {
  return new Promise((resolve) => {
    let settled = false;
    const onError = (error: Error): void => {
      if (settled) return;
      settled = true;
      proc.off('close', onClose);
      resolve({ code: null, signal: null, error });
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      proc.off('error', onError);
      resolve({ code, signal });
    };
    proc.once('error', onError);
    proc.once('close', onClose);
  });
}

function isLiveProcess(proc: ChildProcess | undefined): proc is ChildProcess {
  return proc !== undefined && proc.exitCode === null;
}

function isWritable(stream: ChildProcess['stdin']): stream is NonNullable<ChildProcess['stdin']> {
  return stream !== null && !stream.destroyed;
}

function writePersistentTurn(stdin: NonNullable<ChildProcess['stdin']>, userMessage: string): Promise<void> {
  const line = `${JSON.stringify({ type: 'user', message: { role: 'user', content: userMessage } })}\n`;

  return new Promise((resolve, reject) => {
    stdin.write(line, 'utf8', (err?: Error | null) => {
      if (err !== undefined && err !== null) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

async function terminateProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) {
    return;
  }

  const exitedAfterTerm = waitForProcessCloseOrTimeout(proc, HARD_KILL_GRACE_MS);
  proc.kill('SIGTERM');

  if ((await exitedAfterTerm) || proc.exitCode !== null) {
    return;
  }

  const exitedAfterKill = waitForProcessCloseOrTimeout(proc, HARD_KILL_GRACE_MS);
  proc.kill('SIGKILL');
  await exitedAfterKill;
}

function waitForProcessCloseOrTimeout(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      proc.off('close', onClose);
      proc.off('exit', onExit);
      proc.off('error', onError);
      resolve(closed);
    };
    const onClose = (): void => finish(true);
    const onExit = (): void => finish(true);
    const onError = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);

    proc.once('close', onClose);
    proc.once('exit', onExit);
    proc.once('error', onError);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isReadable(value: unknown): value is Readable {
  return value !== null && value !== undefined && typeof (value as Readable).pipe === 'function';
}

function isResumeSessionError(event: Extract<AgentEvent, { type: 'message.error' }>): boolean {
  const text = `${event.code ?? ''} ${event.message}`.toLowerCase();
  return text.includes('resume') || text.includes('session_id') || text.includes('session not found');
}

function toAgentErrorEvent(err: unknown): Extract<AgentEvent, { type: 'message.error' }> {
  return {
    type: 'message.error',
    code: err instanceof AgentProcessError ? 'process_error' : 'internal_error',
    message: err instanceof Error ? err.message : String(err),
  };
}

function agentSessionScopeMismatchEvent(): Extract<AgentEvent, { type: 'message.error' }> {
  return {
    type: 'message.error',
    code: 'agent_session_scope_mismatch',
    message: 'Agent session is not available for this tenant or user',
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
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

function getNonEmptyString(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

async function writeFileExclusive(targetPath: string, content: string, uid: number, gid: number): Promise<void> {
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
  const fh = await open(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o644);
  try {
    await fh.writeFile(content, 'utf8');
    if (uid > 0) await fh.chown(uid, gid || uid);
  } finally {
    await fh.close();
  }
  await rename(tmpPath, targetPath);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class AgentProcessError extends Error {}
