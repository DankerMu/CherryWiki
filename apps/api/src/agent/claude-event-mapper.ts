import type { AgentEvent, AgentUsage } from './dto/agent.dto.js';

export type ClaudeEventMapperCallbacks = {
  onSessionId?: (sessionId: string) => void;
};

export function* mapClaudeEvent(
  event: Record<string, unknown>,
  callbacks: ClaudeEventMapperCallbacks = {},
): Generator<AgentEvent> {
  if (event.type === 'system' && event.subtype === 'init') {
    if (typeof event.session_id === 'string' && event.session_id.length > 0) {
      callbacks.onSessionId?.(event.session_id);
    }

    return;
  }

  if (event.type === 'assistant') {
    const message = isRecord(event.message) ? event.message : {};
    const content = Array.isArray(message.content) ? message.content : [];

    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }

      if (item.type === 'text' && typeof item.text === 'string') {
        yield { type: 'message.delta', delta: item.text };
        continue;
      }

      if (item.type === 'tool_use') {
        const toolEvent: AgentEvent = {
          type: 'agent.tool_use',
          name: typeof item.name === 'string' ? item.name : 'unknown',
          input: isRecord(item.input) ? item.input : {},
        };

        if (typeof item.id === 'string') {
          yield { ...toolEvent, id: item.id };
        } else {
          yield toolEvent;
        }
      }
    }

    return;
  }

  if (event.type === 'user') {
    const message = isRecord(event.message) ? event.message : {};
    const content = Array.isArray(message.content) ? message.content : [];

    for (const item of content) {
      if (!isRecord(item) || item.type !== 'tool_result') {
        continue;
      }

      for (const chart of extractChartEnvelopes(item.content)) {
        const chartEvent: AgentEvent = {
          type: 'chart.data',
          data: chart,
        };

        if (typeof chart.chart_type === 'string') {
          chartEvent.chart_type = chart.chart_type;
        }

        if ('echarts_option' in chart) {
          chartEvent.echarts_option = chart.echarts_option;
        }

        yield chartEvent;
      }
    }

    return;
  }

  if (event.type === 'result') {
    if (event.subtype === 'success') {
      const completed: Extract<AgentEvent, { type: 'message.completed' }> = {
        type: 'message.completed',
      };

      if (typeof event.session_id === 'string') {
        completed.session_id = event.session_id;
        callbacks.onSessionId?.(event.session_id);
      }

      if (typeof event.result === 'string') {
        completed.result = event.result;
      }

      const usage = normalizeUsage(event.usage);
      if (usage !== undefined) {
        completed.usage = usage;
      }

      if (typeof event.total_cost_usd === 'number') {
        completed.total_cost_usd = event.total_cost_usd;
      }

      yield completed;
      return;
    }

    if (typeof event.subtype === 'string' && event.subtype.startsWith('error')) {
      yield {
        type: 'message.error',
        code: event.subtype,
        message: normalizeErrorMessage(event),
      };
    }
  }
}

export function extractChartEnvelopes(value: unknown): Record<string, unknown>[] {
  const candidates = flattenToolResultContent(value);
  const charts: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    if (isRecord(candidate) && candidate.type === 'cherrywiki.chart') {
      charts.push(candidate);
      continue;
    }

    if (typeof candidate !== 'string') {
      continue;
    }

    const parsed = parseJsonLine(candidate.trim());
    if (isRecord(parsed) && parsed.type === 'cherrywiki.chart') {
      charts.push(parsed);
    }
  }

  return charts;
}

export function flattenToolResultContent(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => {
      if (isRecord(item) && 'text' in item) {
        return [item.text];
      }

      return [item];
    });
  }

  return [value];
}

export function normalizeUsage(value: unknown): AgentUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage: AgentUsage = {};
  if (typeof value.input_tokens === 'number') {
    usage.input_tokens = value.input_tokens;
  }

  if (typeof value.output_tokens === 'number') {
    usage.output_tokens = value.output_tokens;
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}

export function normalizeErrorMessage(event: Record<string, unknown>): string {
  if (typeof event.error === 'string') {
    return event.error;
  }

  if (typeof event.message === 'string') {
    return event.message;
  }

  if (typeof event.result === 'string') {
    return event.result;
  }

  return 'Agent execution failed';
}

export function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
