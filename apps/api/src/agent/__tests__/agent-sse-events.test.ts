import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { StreamParser } from '../stream-parser.js';
import { collectAsync } from './agent-test-utils.js';

void spawn;

describe('StreamParser stream-json mapping', () => {
  it('maps Claude stream-json text, tool use, chart data, and success results', async () => {
    const parser = new StreamParser();
    const stdout = new PassThrough();
    const sessionIds: string[] = [];
    const eventsPromise = collectAsync(parser.parse(stdout, { onSessionId: (sessionId) => sessionIds.push(sessionId) }));

    stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-stream' })}\n`);
    stdout.write(
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'graphify query "SSO"' } },
          ],
        },
      })}\n`,
    );
    stdout.write(
      `${JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: JSON.stringify({
                type: 'cherrywiki.chart',
                chart_type: 'bar',
                echarts_option: { xAxis: {}, series: [] },
              }),
            },
          ],
        },
      })}\n`,
    );
    stdout.write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'session-stream',
        result: 'done',
        total_cost_usd: 0.02,
        usage: { input_tokens: 5, output_tokens: 7 },
      })}\n`,
    );
    stdout.end();

    await expect(eventsPromise).resolves.toEqual([
      { type: 'message.delta', delta: 'hello' },
      { type: 'agent.tool_use', id: 'tool-1', name: 'Bash', input: { command: 'graphify query "SSO"' } },
      {
        type: 'chart.data',
        chart_type: 'bar',
        echarts_option: { xAxis: {}, series: [] },
        data: {
          type: 'cherrywiki.chart',
          chart_type: 'bar',
          echarts_option: { xAxis: {}, series: [] },
        },
      },
      {
        type: 'message.completed',
        session_id: 'session-stream',
        result: 'done',
        total_cost_usd: 0.02,
        usage: { input_tokens: 5, output_tokens: 7 },
      },
    ]);
    expect(sessionIds).toEqual(['session-stream', 'session-stream']);
  });

  it('ignores malformed JSON and maps result errors to message.error', async () => {
    const parser = new StreamParser();
    const stdout = new PassThrough();
    const eventsPromise = collectAsync(parser.parse(stdout));

    stdout.write('not-json\n');
    stdout.write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        error: 'tool failed',
      })}\n`,
    );
    stdout.end();

    await expect(eventsPromise).resolves.toEqual([
      { type: 'message.error', code: 'error_during_execution', message: 'tool failed' },
    ]);
  });
});
