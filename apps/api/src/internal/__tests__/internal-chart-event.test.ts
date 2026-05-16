import 'reflect-metadata';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from '../../agent/agent.service.js';
import { configureApp } from '../../main.js';
import { AgentTokenGuard } from '../agent-token.guard.js';
import { InternalChartEventController } from '../internal-chart-event.controller.js';

type AgentServiceMock = Pick<AgentService, 'injectChartEvent'>;

const originalAgentToken = process.env.CHERRY_AGENT_TOKEN;
const AGENT_TOKEN = 'agent-secret';
const ENDPOINT = '/api/internal/agent/chart-event';

describe('InternalChartEventController', () => {
  let app: NestFastifyApplication | undefined;
  let agentService: AgentServiceMock;

  beforeEach(async () => {
    process.env.CHERRY_AGENT_TOKEN = AGENT_TOKEN;
    agentService = {
      injectChartEvent: vi.fn<AgentService['injectChartEvent']>(() => 'injected'),
    };
    app = await createTestApp(agentService);
  });

  afterEach(async () => {
    process.env.CHERRY_AGENT_TOKEN = originalAgentToken;
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('returns 202 for a valid request with a correct token', async () => {
    const chart = createChartEnvelope();

    const response = await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({ conversationId: 'conversation-1', chart })
      .expect(202);

    expect(response.body).toEqual({ status: 'injected' });
    expect(agentService.injectChartEvent).toHaveBeenCalledWith('conversation-1', chart);
  });

  it('rejects an invalid token with 401', async () => {
    await postChartEvent()
      .set('Authorization', 'Bearer wrong-secret')
      .send({ conversationId: 'conversation-1', chart: createChartEnvelope() })
      .expect(401);

    expect(agentService.injectChartEvent).not.toHaveBeenCalled();
  });

  it("returns 404 when AgentService returns 'not_found'", async () => {
    vi.mocked(agentService.injectChartEvent).mockReturnValueOnce('not_found');

    await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({ conversationId: 'missing-conversation', chart: createChartEnvelope() })
      .expect(404);
  });

  it('rejects a missing conversationId with 400', async () => {
    await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({ chart: createChartEnvelope() })
      .expect(400);

    expect(agentService.injectChartEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing chart object with 400', async () => {
    await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({ conversationId: 'conversation-1' })
      .expect(400);

    expect(agentService.injectChartEvent).not.toHaveBeenCalled();
  });

  it('rejects a chart envelope with the wrong type with 400', async () => {
    await postChartEvent()
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .send({
        conversationId: 'conversation-1',
        chart: { ...createChartEnvelope(), type: 'wrong.chart' },
      })
      .expect(400);

    expect(agentService.injectChartEvent).not.toHaveBeenCalled();
  });

  function postChartEvent(): request.Test {
    if (app === undefined) {
      throw new Error('Test app was not initialized');
    }

    return request(app.getHttpAdapter().getInstance().server).post(ENDPOINT);
  }
});

async function createTestApp(agentService: AgentServiceMock): Promise<NestFastifyApplication> {
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

function createChartEnvelope(): Record<string, unknown> {
  return {
    type: 'cherrywiki.chart',
    chart_type: 'bar',
    echarts_option: {
      xAxis: { data: ['A', 'B'] },
      series: [{ data: [1, 2] }],
    },
  };
}
