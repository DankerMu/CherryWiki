// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { AuthProvider, type AuthUser } from '../lib/auth.js';
import Chat, { ChatMessageBubble, MessageInput, SessionSidebar } from '../pages/Chat.js';
import { CHAT_INPUT_MAX_LENGTH, ChatStreamError, type ChatCitation, type ChatMessage } from '../hooks/useChatStream.js';

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="echarts-chart">ECharts component</div>,
}));

const testUser: AuthUser = {
  id: 'user-1',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
  groups: [],
  spaces: [{ id: 'space-1', name: 'Space One', role: 'viewer' }],
};

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Chat message rendering', () => {
  it('renders user and assistant bubbles', () => {
    renderWithRouter(
      <>
        <ChatMessageBubble message={buildMessage({ role: 'user', content: 'Hello wiki' })} spaceId="space-1" />
        <ChatMessageBubble
          message={buildMessage({ role: 'assistant', content: 'Hello **back** from CherryWiki' })}
          spaceId="space-1"
        />
      </>,
    );

    expect(screen.getByLabelText('user message')).toHaveTextContent('Hello wiki');
    expect(screen.getByLabelText('assistant message')).toHaveTextContent('Hello back from CherryWiki');
    expect(screen.getByText('back')).toHaveProperty('tagName', 'STRONG');
  });

  it('routes citation clicks to the wiki page', async () => {
    const citation = buildCitation({ index: 1, source_chain_json: { page_id: 'target-page' } });

    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <Routes>
          <Route
            path="/spaces/:spaceId/chat"
            element={
              <ChatMessageBubble
                message={buildMessage({ role: 'assistant', content: 'Use this source [^1].', citations: [citation] })}
                spaceId="space-1"
              />
            }
          />
          <Route path="/spaces/:spaceId/wiki/:pageId" element={<h1>Wiki target</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '[1]' }));

    expect(await screen.findByRole('heading', { name: 'Wiki target' })).toBeInTheDocument();
  });
});

describe('Session sidebar', () => {
  it('renders sessions ordered by the provided list', () => {
    renderWithRouter(
      <SessionSidebar
        sessions={[
          {
            id: 'session-new',
            title: 'Latest chat',
            created_at: '2026-05-02T10:00:00.000Z',
            updated_at: '2026-05-02T11:00:00.000Z',
          },
          {
            id: 'session-old',
            title: null,
            created_at: '2026-05-01T10:00:00.000Z',
            updated_at: '2026-05-01T11:00:00.000Z',
          },
        ]}
        activeSessionId="session-new"
        isLoading={false}
        onNewChat={vi.fn()}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />,
    );

    expect(screen.getByText('Latest chat')).toBeInTheDocument();
    expect(screen.getByText('Chat session-')).toBeInTheDocument();
  });
});

describe('Message input', () => {
  it('enforces the 4000 character limit', async () => {
    const onSend = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(<MessageInput disabled={false} isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('消息');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(CHAT_INPUT_MAX_LENGTH + 25) } });

    expect(textarea.value).toHaveLength(CHAT_INPUT_MAX_LENGTH);
    expect(screen.getByText(`${CHAT_INPUT_MAX_LENGTH}/${CHAT_INPUT_MAX_LENGTH}`)).toHaveClass('warning');

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[0]).toHaveLength(CHAT_INPUT_MAX_LENGTH);
  });
});

describe('Phase 3 chat controls and stream events', () => {
  it('sends enable_deep_analysis when the deep analysis toggle is on', async () => {
    const fetchState = stubChatFetch({
      streamEvents: [{ event: 'message.completed', data: { latency_ms: 42 } }],
    });

    renderChatRoute();

    fireEvent.click(await screen.findByRole('button', { name: '深度分析' }));
    await sendChatMessage('explain the architecture');

    await waitFor(() => expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({ enable_deep_analysis: true }));
    expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({
      message: 'explain the architecture',
      retrieval_mode: 'wiki_only',
    });
  });

  it('shows the database toggle only when the space database config is enabled', async () => {
    stubChatFetch({ databaseEnabled: false });
    renderChatRoute();

    await screen.findByLabelText('消息');
    expect(screen.queryByRole('button', { name: '数据库' })).not.toBeInTheDocument();

    cleanup();
    vi.unstubAllGlobals();

    stubChatFetch({ databaseEnabled: true });
    renderChatRoute();

    expect(await screen.findByRole('button', { name: '数据库' })).toBeInTheDocument();
  });

  it('renders agent.tool_use events as a collapsed tool panel', async () => {
    stubChatFetch({
      streamEvents: [
        {
          event: 'agent.tool_use',
          data: { id: 'tool-1', name: 'Bash', input: { command: 'cherrydb query "SELECT count(*) FROM orders"' } },
        },
        { event: 'message.completed', data: {} },
      ],
    });

    renderChatRoute();

    fireEvent.click(await screen.findByRole('button', { name: '深度分析' }));
    await sendChatMessage('run a database check');

    expect(await screen.findByText('Bash')).toBeInTheDocument();
    expect(screen.getAllByText(/cherrydb query/).length).toBeGreaterThan(0);
  });

  it('renders chart.data events with the ECharts component', async () => {
    stubChatFetch({
      streamEvents: [
        {
          event: 'chart.data',
          data: {
            type: 'cherrywiki.chart',
            chart_type: 'bar',
            echarts_option: { xAxis: { type: 'category' }, yAxis: {}, series: [{ type: 'bar', data: [1, 2] }] },
          },
        },
        { event: 'message.completed', data: {} },
      ],
    });

    renderChatRoute();
    await sendChatMessage('show a chart');

    expect(await screen.findByTestId('echarts-chart')).toBeInTheDocument();
    expect(screen.getByText('bar')).toBeInTheDocument();
  });

  it('marks the assistant message complete and displays latency from message.completed', async () => {
    stubChatFetch({
      streamEvents: [
        { event: 'content', data: { delta: 'Done.' } },
        { event: 'message.completed', data: { latency_ms: 123 } },
      ],
    });

    renderChatRoute();
    await sendChatMessage('finish quickly');

    const complete = await screen.findByLabelText('Message complete');
    expect(complete).toHaveTextContent('完成');
    expect(complete).toHaveTextContent('123ms');
  });

  it('sends the selected retrieval mode', async () => {
    const fetchState = stubChatFetch({
      streamEvents: [{ event: 'message.completed', data: {} }],
    });

    renderChatRoute();

    // antd Select renders a combobox input; find the retrieval mode selector
    // via its surrounding label text and the Select's internal input.
    const selectWrapper = await screen.findByText('检索模式');
    const combobox = selectWrapper.closest('.chat-retrieval-mode-label')?.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(combobox).not.toBeNull();
    fireEvent.mouseDown(combobox!);
    const pathOption = await screen.findByText('路径优先');
    fireEvent.click(pathOption);

    expect(screen.getByText('Agent')).toBeInTheDocument();
    await sendChatMessage('trace the path');

    await waitFor(() => expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({ retrieval_mode: 'path_first' }));
  });
});

describe('Chat error state', () => {
  it('shows the configured no-model error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input, init) => {
        const path = getRequestPath(input);

        if (path === '/api/spaces/space-1/chat/sessions' && init?.method !== 'POST') {
          return Promise.resolve(jsonResponse({ data: [], meta: { request_id: 'req-sessions' } }));
        }

        if (path === '/api/spaces/space-1') {
          return Promise.resolve(jsonResponse({ data: { id: 'space-1', database_config: { enabled: false } } }));
        }

        if (path === '/api/chat/completions') {
          return Promise.resolve(
            jsonResponse(
              {
                error: {
                  code: 'NO_CHAT_MODEL_CONFIGURED',
                  message: 'No enabled chat model configured',
                },
              },
              422,
            ),
          );
        }

        return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
      }),
    );

    renderChatRoute();

    const textarea = await screen.findByLabelText('消息');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(await screen.findByText('请联系管理员配置聊天模型')).toBeInTheDocument();
  });

  it('maps no-model stream errors to the configured copy', () => {
    const error = new ChatStreamError({
      code: 'NO_CHAT_MODEL_CONFIGURED',
      message: 'No enabled chat model configured',
      status: 422,
    });

    expect(error.code).toBe('NO_CHAT_MODEL_CONFIGURED');
  });
});

function renderChatRoute(): void {
  render(
    <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
      <AuthProvider initialSession={{ user: testUser, accessToken: 'test-token' }}>
        <Routes>
          <Route path="/spaces/:spaceId/chat" element={<Chat />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderWithRouter(element: ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

function buildMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    session_id: 'session-1',
    role: 'assistant',
    content: 'Assistant reply',
    parts: [],
    citations: [],
    usage: null,
    created_at: '2026-05-01T10:00:00.000Z',
    status: 'complete',
    agentPath: false,
    agentThinking: false,
    completedAt: null,
    latencyMs: null,
    firstSseLatencyMs: null,
    ...overrides,
  };
}

function buildCitation(overrides: Partial<ChatCitation> = {}): ChatCitation {
  return {
    index: 1,
    chunk_id: 'chunk-1',
    wiki_page_pk: 'wiki-page-pk-1',
    section_id: 'section-1',
    relevance_score: 0.87,
    source_chain_json: {},
    display_text: 'Auth / SSO',
    page_title: 'Auth',
    section_title: 'SSO',
    fallback: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchCall = {
  path: string;
  body: unknown;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

function stubChatFetch({
  databaseEnabled = false,
  streamEvents = [],
}: {
  databaseEnabled?: boolean;
  streamEvents?: StreamEvent[];
} = {}): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => {
      const path = getRequestPath(input);
      calls.push({ path, body: parseRequestBody(init?.body) });

      if (path === '/api/spaces/space-1') {
        return Promise.resolve(jsonResponse({ data: { id: 'space-1', database_config: { enabled: databaseEnabled } } }));
      }

      if (path === '/api/spaces/space-1/chat/sessions' && init?.method !== 'POST') {
        return Promise.resolve(jsonResponse({ data: [], meta: { request_id: 'req-sessions' } }));
      }

      if (path === '/api/chat/completions') {
        return Promise.resolve(sseResponse(streamEvents));
      }

      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
    }),
  );

  return { calls };
}

async function sendChatMessage(message: string): Promise<void> {
  const textarea = await screen.findByLabelText('消息');
  fireEvent.change(textarea, { target: { value: message } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

function getLastChatCompletionBody(calls: FetchCall[]): Record<string, unknown> {
  const call = [...calls].reverse().find((item) => item.path === '/api/chat/completions');
  expect(call).toBeDefined();
  expect(call?.body).toEqual(expect.any(Object));
  return call?.body as Record<string, unknown>;
}

function sseResponse(events: StreamEvent[]): Response {
  const encoder = new TextEncoder();
  const streamText = `${events
    .map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
    .join('')}data: [DONE]\n\n`;

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(streamText));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input.split('?')[0] ?? input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return input.url.split('?')[0] ?? input.url;
}
