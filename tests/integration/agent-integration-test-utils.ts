import type { AuditService } from '../../apps/api/src/audit/audit.service.js';
import type { DrizzleDatabase } from '../../apps/api/src/database/drizzle.module.js';
import { AgentService } from '../../apps/api/src/agent/agent.service.js';
import { AuditCapture } from '../../apps/api/src/agent/audit-capture.js';
import { ClaudeMdGenerator } from '../../apps/api/src/agent/claude-md-generator.js';
import type { AgentEvent } from '../../apps/api/src/agent/dto/agent.dto.js';
import { SessionManager } from '../../apps/api/src/agent/session-manager.js';
import { SettingsGenerator } from '../../apps/api/src/agent/settings-generator.js';
import { StreamParser } from '../../apps/api/src/agent/stream-parser.js';
import type { ScriptedChatDb } from './chat-integration-test-utils.js';

export type MockAgentCall = {
  conversationId: string;
  spaceId?: string;
  message: string;
  options: Record<string, unknown>;
};

export class ScriptedAgentService {
  readonly spawnCalls: MockAgentCall[] = [];
  readonly resumeCalls: MockAgentCall[] = [];
  private readonly sessions = new Set<string>();

  constructor(
    private readonly spawnEvents: AgentEvent[],
    private readonly resumeEvents: AgentEvent[] = spawnEvents,
  ) {}

  hasSession(conversationId: string, _options?: { includePersisted?: boolean }): boolean | Promise<boolean> {
    return this.sessions.has(conversationId);
  }

  async *sendTurn(
    conversationId: string,
    spaceId: string,
    message: string,
    options: Record<string, unknown> = {},
  ): AsyncGenerator<AgentEvent> {
    const isResume = this.sessions.has(conversationId);
    this.sessions.add(conversationId);
    if (isResume) {
      this.resumeCalls.push({ conversationId, message, options });
      yield* scriptedEvents(this.resumeEvents);
    } else {
      this.spawnCalls.push({ conversationId, spaceId, message, options });
      yield* scriptedEvents(this.spawnEvents);
    }
  }

  async *spawnNew(
    conversationId: string,
    spaceId: string,
    message: string,
    options: Record<string, unknown> = {},
  ): AsyncGenerator<AgentEvent> {
    this.sessions.add(conversationId);
    this.spawnCalls.push({ conversationId, spaceId, message, options });
    yield* scriptedEvents(this.spawnEvents);
  }

  async *resume(
    conversationId: string,
    message: string,
    options: Record<string, unknown> = {},
  ): AsyncGenerator<AgentEvent> {
    this.resumeCalls.push({ conversationId, message, options });
    yield* scriptedEvents(this.resumeEvents);
  }

  close(conversationId: string): Promise<void> {
    this.sessions.delete(conversationId);
    return Promise.resolve();
  }
}

export class TimedAgentService extends ScriptedAgentService {
  constructor(
    private readonly firstDelayMs: number,
    private readonly totalDelayMs: number,
  ) {
    super([]);
  }

  override async *sendTurn(
    conversationId: string,
    spaceId: string,
    message: string,
    options: Record<string, unknown> = {},
  ): AsyncGenerator<AgentEvent> {
    this.spawnCalls.push({ conversationId, spaceId, message, options });
    await sleep(this.firstDelayMs);
    yield { type: 'message.delta', delta: 'deep answer' };
    await sleep(Math.max(0, this.totalDelayMs - this.firstDelayMs));
    yield { type: 'message.completed', usage: { input_tokens: 12, output_tokens: 4 } };
  }

  override async *spawnNew(
    conversationId: string,
    spaceId: string,
    message: string,
    options: Record<string, unknown> = {},
  ): AsyncGenerator<AgentEvent> {
    this.spawnCalls.push({ conversationId, spaceId, message, options });
    await sleep(this.firstDelayMs);
    yield { type: 'message.delta', delta: 'deep answer' };
    await sleep(Math.max(0, this.totalDelayMs - this.firstDelayMs));
    yield { type: 'message.completed', usage: { input_tokens: 12, output_tokens: 4 } };
  }
}

export function createRealAgentService(input: {
  db: ScriptedChatDb;
  audit: AuditService;
  managers: SessionManager[];
}): AgentService {
  const manager = new SessionManager();
  input.managers.push(manager);
  return new AgentService(
    input.db.asDrizzle() as unknown as DrizzleDatabase,
    manager,
    new StreamParser(),
    new AuditCapture(input.audit),
    new ClaudeMdGenerator(),
    new SettingsGenerator(),
  );
}

export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of iterable) {
    collected.push(item);
  }

  return collected;
}

export function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

async function* scriptedEvents(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  await Promise.resolve();
  for (const event of events) {
    yield event;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
