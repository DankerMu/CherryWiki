import 'reflect-metadata';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from '../../agent/agent.service.js';
import { AuditCapture } from '../../agent/audit-capture.js';
import { ClaudeMdGenerator } from '../../agent/claude-md-generator.js';
import type { AgentEvent } from '../../agent/dto/agent.dto.js';
import { PersistentStreamParser } from '../../agent/persistent-stream-parser.js';
import { SessionManager } from '../../agent/session-manager.js';
import { SettingsGenerator } from '../../agent/settings-generator.js';
import { StreamParser } from '../../agent/stream-parser.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import { configureApp } from '../../main.js';
import { AgentTokenGuard } from '../agent-token.guard.js';
import { InternalChartEventController } from '../internal-chart-event.controller.js';

type ServiceWithParsers = {
  persistentParsers: Map<string, PersistentStreamParser>;
};

class ChartEventE2eDb {
  insert(): { values: () => Promise<void> } {
    return {
      values: () => Promise.resolve(),
    };
  }
}

const originalAgentToken = process.env.CHERRY_AGENT_TOKEN;
const AGENT_TOKEN = 'test-e2e-token';
const ENDPOINT = '/api/internal/agent/chart-event';

describe('chart-event endpoint to SSE pipeline', () => {
  let app: NestFastifyApplication | undefined;
  let service: AgentService | undefined;
  let sessionManager: SessionManager | undefined;
  const parsers: PersistentStreamParser[] = [];

  beforeEach(async () => {
    process.env.CHERRY_AGENT_TOKEN = AGENT_TOKEN;
    sessionManager = new SessionManager();
    service = createAgentService(sessionManager);
    app = await createTestApp(service);
  });

  afterEach(async () => {
    process.env.CHERRY_AGENT_TOKEN = originalAgentToken;
    for (const parser of parsers.splice(0)) {
      parser.stop();
    }
    await app?.close();
    await sessionManager?.onModuleDestroy();
    app = undefined;
    service = undefined;
    sessionManager = undefined;
    vi.restoreAllMocks();
  });

  it('full pipeline: POST chart-event -> AgentService -> TurnEventQueue -> consumer receives chart.data', async () => {
    const activeTurn = createActiveTurn('conversation-full-pipeline');
    const collector = collectEvents(activeTurn.turn);
    const chart = createChartEnvelope();

    await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({ conversationId: activeTurn.conversationId, chart })
      .expect(202);

    await collector.waitForCount(1);
    expect(collector.events).toEqual([
      {
        type: 'chart.data',
        chart_type: 'bar',
        echarts_option: chart.echarts_option,
        data: chart,
      },
    ]);

    activeTurn.stdout.end();
    await collector.done;
  });

  it('chart.data event contains correct chart_type and echarts_option', async () => {
    const activeTurn = createActiveTurn('conversation-chart-payload');
    const collector = collectEvents(activeTurn.turn);
    const chart = createChartEnvelope({
      chart_type: 'line',
      echarts_option: {
        xAxis: { type: 'category', data: ['Jan', 'Feb'] },
        yAxis: { type: 'value' },
        series: [{ type: 'line', data: [10, 20] }],
      },
    });

    await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({ conversationId: activeTurn.conversationId, chart })
      .expect(202);

    await collector.waitForCount(1);
    const [event] = collector.events;
    expect(event?.type).toBe('chart.data');
    if (event?.type !== 'chart.data') {
      throw new Error('Expected chart.data event');
    }

    expect(event).toMatchObject({
      type: 'chart.data',
      chart_type: 'line',
      echarts_option: chart.echarts_option,
    });
    expect(event?.data).toEqual(chart);

    activeTurn.stdout.end();
    await collector.done;
  });

  it('chart.data arrives before message.completed in event ordering', async () => {
    const activeTurn = createActiveTurn('conversation-event-order');
    const collector = collectEvents(activeTurn.turn);
    const chart = createChartEnvelope();

    await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({ conversationId: activeTurn.conversationId, chart })
      .expect(202);

    await collector.waitForCount(1);
    expect(collector.events.map((event) => event.type)).toEqual(['chart.data']);

    writeClaudeResult(activeTurn.stdout);
    activeTurn.stdout.end();
    await collector.done;

    expect(collector.events.map((event) => event.type)).toEqual(['chart.data', 'message.completed']);
  });

  function createActiveTurn(conversationId: string): {
    conversationId: string;
    parser: PersistentStreamParser;
    stdout: PassThrough;
    turn: AsyncIterable<AgentEvent>;
  } {
    if (service === undefined) {
      throw new Error('AgentService was not initialized');
    }

    const parser = new PersistentStreamParser();
    const stdout = new PassThrough();
    parser.startReading(stdout);
    const turn = parser.createTurn();
    parserMap(service).set(conversationId, parser);
    parsers.push(parser);
    return { conversationId, parser, stdout, turn };
  }

  function postChartEvent(): request.Test {
    if (app === undefined) {
      throw new Error('Test app was not initialized');
    }

    return request(app.getHttpAdapter().getInstance().server).post(ENDPOINT);
  }
});

async function createTestApp(agentService: AgentService): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [InternalChartEventController],
    providers: [AgentTokenGuard, { provide: AgentService, useValue: agentService }],
  }).compile();

  const testApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
  configureApp(testApp);
  await testApp.init();
  await testApp.getHttpAdapter().getInstance().ready();
  return testApp;
}

function createAgentService(sessionManager: SessionManager): AgentService {
  const auditService = { push: vi.fn() } as unknown as AuditService;
  return new AgentService(
    new ChartEventE2eDb() as unknown as DrizzleDatabase,
    sessionManager,
    new StreamParser(),
    new AuditCapture(auditService),
    new ClaudeMdGenerator(),
    new SettingsGenerator(),
  );
}

function parserMap(service: AgentService): Map<string, PersistentStreamParser> {
  return (service as unknown as ServiceWithParsers).persistentParsers;
}

function createChartEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'cherrywiki.chart',
    chart_type: 'bar',
    echarts_option: {
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [1, 2] }],
    },
    rows: [
      { label: 'A', value: 1 },
      { label: 'B', value: 2 },
    ],
    ...overrides,
  };
}

function collectEvents(iterable: AsyncIterable<AgentEvent>): {
  events: AgentEvent[];
  done: Promise<void>;
  waitForCount: (count: number) => Promise<void>;
} {
  const events: AgentEvent[] = [];
  const waiters: Array<{ count: number; resolve: () => void }> = [];

  const notify = (): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter !== undefined && events.length >= waiter.count) {
        waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  };

  const done = (async () => {
    for await (const event of iterable) {
      events.push(event);
      notify();
    }
  })();

  return {
    events,
    done,
    waitForCount: (count: number) => {
      if (events.length >= count) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        waiters.push({ count, resolve });
      });
    },
  };
}

function writeClaudeResult(stdout: PassThrough): void {
  stdout.write(
    `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'provider-session-1',
      result: 'done',
      usage: { input_tokens: 3, output_tokens: 5 },
    })}\n`,
  );
}
