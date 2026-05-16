import 'reflect-metadata';

import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../audit/audit.service.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { AgentService, buildAgentEnv } from '../agent.service.js';
import { AuditCapture } from '../audit-capture.js';
import { ClaudeMdGenerator } from '../claude-md-generator.js';
import type { AgentSessionRecord } from '../dto/agent.dto.js';
import { PersistentStreamParser } from '../persistent-stream-parser.js';
import { SessionManager } from '../session-manager.js';
import { SettingsGenerator } from '../settings-generator.js';
import { StreamParser } from '../stream-parser.js';
import { AgentTestDb, collectAsync } from './agent-test-utils.js';

type ServiceWithParsers = {
  persistentParsers: Map<string, PersistentStreamParser>;
};

const managers: SessionManager[] = [];
const parsers: PersistentStreamParser[] = [];

afterEach(async () => {
  for (const parser of parsers.splice(0)) {
    parser.stop();
  }
  await Promise.all(managers.splice(0).map((manager) => manager.onModuleDestroy()));
});

describe('AgentService.injectChartEvent', () => {
  it("returns 'injected' when parser exists and turn is active", async () => {
    const { service } = createService();
    const conversationId = 'conversation-chart-active';
    const { parser, stdout } = createStartedParser();
    const turn = parser.createTurn();
    const events = collectAsync(turn);
    parserMap(service).set(conversationId, parser);
    const chartData = {
      chart_type: 'bar',
      echarts_option: { xAxis: { type: 'category' }, series: [{ data: [1, 2, 3] }] },
      rows: [{ label: 'A', value: 1 }],
    };

    expect(service.injectChartEvent(conversationId, chartData)).toBe('injected');
    stdout.end();

    await expect(events).resolves.toEqual([
      {
        type: 'chart.data',
        chart_type: 'bar',
        echarts_option: chartData.echarts_option,
        data: chartData,
      },
    ]);
  });

  it("returns 'not_found' when conversationId has no parser", () => {
    const { service } = createService();

    expect(service.injectChartEvent('missing-conversation', { chart_type: 'bar' })).toBe('not_found');
  });

  it("returns 'not_found' when parser has no active turn", () => {
    const { service } = createService();
    const conversationId = 'conversation-chart-idle';
    const { parser } = createStartedParser();
    parserMap(service).set(conversationId, parser);

    expect(service.injectChartEvent(conversationId, { chart_type: 'line' })).toBe('not_found');
  });
});

describe('buildAgentEnv', () => {
  it('sets chart callback URL and conversation id', () => {
    const env = buildAgentEnv(
      createSession({
        conversationId: 'conversation-env',
        apiInternalUrl: 'http://api.internal:8081',
      }),
    );

    expect(env.CHERRY_CHART_CALLBACK_URL).toBe('http://api.internal:8081/api/internal/agent/chart-event');
    expect(env.CHERRY_CONVERSATION_ID).toBe('conversation-env');
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

function createStartedParser(): { parser: PersistentStreamParser; stdout: PassThrough } {
  const parser = new PersistentStreamParser();
  const stdout = new PassThrough();
  parser.startReading(stdout);
  parsers.push(parser);
  return { parser, stdout };
}

function parserMap(service: AgentService): Map<string, PersistentStreamParser> {
  return (service as unknown as ServiceWithParsers).persistentParsers;
}

function createSession(input: { conversationId: string; apiInternalUrl: string }): AgentSessionRecord {
  return {
    conversationId: input.conversationId,
    spaceId: 'space-1',
    sessionId: 'session-1',
    workDir: '/tmp/cherry-agent/conversation-env',
    agentHome: '/tmp/cherry-agent/conversation-env/.home',
    lastActivityAt: Date.now(),
    options: {
      apiInternalUrl: input.apiInternalUrl,
    },
  };
}
