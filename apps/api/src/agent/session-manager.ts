import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { rm } from 'node:fs/promises';

import type { AgentSessionRecord } from './dto/agent.dto.js';

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

@Injectable()
export class SessionManager implements OnModuleDestroy {
  private readonly sessions = new Map<string, AgentSessionRecord>();
  private idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
  private cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS;
  private cleanupTimer = this.startCleanupTimer();

  setSession(session: AgentSessionRecord): void {
    this.sessions.set(session.conversationId, {
      ...session,
      lastActivityAt: session.lastActivityAt,
    });
  }

  getSession(conversationId: string): AgentSessionRecord | undefined {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return undefined;
    }

    return { ...session };
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.has(conversationId);
  }

  touch(conversationId: string, at = Date.now()): void {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    this.sessions.set(conversationId, { ...session, lastActivityAt: at });
  }

  setSessionId(conversationId: string, sessionId: string): void {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    this.sessions.set(conversationId, { ...session, sessionId, lastActivityAt: Date.now() });
  }

  setProcessRef(conversationId: string, processRef: AgentSessionRecord['processRef']): void {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    this.sessions.set(conversationId, {
      ...session,
      ...(processRef !== undefined ? { processRef } : {}),
      lastActivityAt: Date.now(),
    });
  }

  clearProcessRef(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    const { processRef: _processRef, ...rest } = session;
    this.sessions.set(conversationId, { ...rest, lastActivityAt: Date.now() });
  }

  async close(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session === undefined) {
      return;
    }

    this.sessions.delete(conversationId);
    await this.cleanupSessionDirectory(session);
  }

  async cleanupAll(): Promise<void> {
    const conversationIds = [...this.sessions.keys()];
    await Promise.all(conversationIds.map((conversationId) => this.close(conversationId)));
  }

  async sweepIdleSessions(now = Date.now()): Promise<string[]> {
    const idleConversationIds = [...this.sessions.values()]
      .filter((session) => now - session.lastActivityAt >= this.idleTimeoutMs)
      .map((session) => session.conversationId);

    for (const conversationId of idleConversationIds) {
      await this.close(conversationId);
    }

    return idleConversationIds;
  }

  size(): number {
    return this.sessions.size;
  }

  configureForTests(input: { idleTimeoutMs?: number; cleanupIntervalMs?: number }): void {
    if (input.idleTimeoutMs !== undefined) {
      this.idleTimeoutMs = input.idleTimeoutMs;
    }

    if (input.cleanupIntervalMs !== undefined) {
      this.cleanupIntervalMs = input.cleanupIntervalMs;
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = this.startCleanupTimer();
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.cleanupTimer);
    await this.cleanupAll();
  }

  private startCleanupTimer(): NodeJS.Timeout {
    const timer = setInterval(() => {
      void this.sweepIdleSessions();
    }, this.cleanupIntervalMs);
    timer.unref();
    return timer;
  }

  private async cleanupSessionDirectory(session: AgentSessionRecord): Promise<void> {
    if (session.processRef !== undefined && session.processRef.exitCode === null) {
      session.processRef.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (session.processRef !== undefined && session.processRef.exitCode === null) {
            session.processRef.kill('SIGKILL');
          }
          resolve();
        }, 5_000);
        timer.unref();
        session.processRef!.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await rm(session.workDir, { recursive: true, force: true });
  }
}
