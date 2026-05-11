// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { AuthProvider, type AuthUser } from '../lib/auth.js';
import Chat, { ChatMessageBubble, MessageInput, SessionSidebar, SpaceSelector } from '../pages/Chat.js';
import {
  CHAT_INPUT_MAX_LENGTH,
  ChatStreamError,
  normalizeCitation,
  type ChatCitation,
  type ChatMessage,
} from '../hooks/useChatStream.js';

vi.mock('echarts-for-react', () => ({
  default: () => <div data-testid="echarts-chart">ECharts component</div>,
}));

const testUser: AuthUser = {
  id: 'user-1',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
  groups: [],
  spaces: [
    { id: 'space-1', name: 'Space One', role: 'viewer' },
    { id: 'space-2', name: 'Space Two', role: 'viewer' },
  ],
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

  it('routes secondary-space citations to their source space', async () => {
    const citation = buildCitation({
      index: 1,
      space_id: 'space-2',
      page_id: 'target-page',
      page_title: 'Secondary Source',
    });

    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <Routes>
          <Route
            path="/spaces/:spaceId/chat"
            element={
              <ChatMessageBubble
                message={buildMessage({ role: 'assistant', content: 'Use this source [^1].', citations: [citation] })}
                spaceId="space-1"
                spaceNameById={{ 'space-2': 'Space Two' }}
              />
            }
          />
          <Route path="/spaces/space-1/wiki/:pageId" element={<h1>Wrong space</h1>} />
          <Route path="/spaces/space-2/wiki/:pageId" element={<h1>Secondary wiki target</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '[1]' }));

    expect(await screen.findByRole('heading', { name: 'Secondary wiki target' })).toBeInTheDocument();
  });

  it('normalizes citation space_id from API payloads', () => {
    expect(
      normalizeCitation({
        index: 2,
        chunk_id: 'chunk-2',
        wiki_page_pk: 'wiki-2',
        space_id: 'space-2',
        page_id: 'page-2',
        page_title: 'Page 2',
      }),
    ).toMatchObject({
      index: 2,
      space_id: 'space-2',
      page_id: 'page-2',
    });
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
            space_ids: ['space-1', 'space-2'],
            space_details: [
              { id: 'space-1', name: 'Space One' },
              { id: 'space-2', name: 'Space Two' },
            ],
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
    expect(screen.getByText('2 空间')).toBeInTheDocument();
    expect(screen.getByText(/Space One、Space Two/)).toBeInTheDocument();
  });
});

describe('Space selector', () => {
  it('renders with the route space selected as primary', () => {
    renderWithRouter(
      <SpaceSelector
        availableSpaces={[
          { id: 'space-1', name: 'Space One' },
          { id: 'space-2', name: 'Space Two' },
        ]}
        selectedSpaceIds={['space-1']}
        primarySpaceId="space-1"
        locked={false}
        onChange={vi.fn()}
        onStartNewSession={vi.fn()}
      />,
    );

    expect(screen.getByText('Space One（主）')).toBeInTheDocument();
  });

  it('adds spaces while preserving the route space first', async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <SpaceSelector
        availableSpaces={[
          { id: 'space-1', name: 'Space One' },
          { id: 'space-2', name: 'Space Two' },
        ]}
        selectedSpaceIds={['space-1']}
        primarySpaceId="space-1"
        locked={false}
        onChange={onChange}
        onStartNewSession={vi.fn()}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByText('Space Two'));

    expect(onChange).toHaveBeenCalledWith(['space-1', 'space-2']);
  });

  it('removes secondary spaces without removing the route space', () => {
    const onChange = vi.fn();
    renderWithRouter(
      <SpaceSelector
        availableSpaces={[
          { id: 'space-1', name: 'Space One' },
          { id: 'space-2', name: 'Space Two' },
        ]}
        selectedSpaceIds={['space-1', 'space-2']}
        primarySpaceId="space-1"
        locked={false}
        onChange={onChange}
        onStartNewSession={vi.fn()}
      />,
    );

    const closeButton = document.querySelector('.ant-tag-close-icon');
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton!);

    expect(onChange).toHaveBeenCalledWith(['space-1']);
  });

  it('locks selection during an active session', () => {
    renderWithRouter(
      <SpaceSelector
        availableSpaces={[{ id: 'space-1', name: 'Space One' }]}
        selectedSpaceIds={['space-1']}
        primarySpaceId="space-1"
        locked
        onChange={vi.fn()}
        onStartNewSession={vi.fn()}
      />,
    );

    expect(document.querySelector('.chat-space-selector.ant-select-disabled')).toBeInTheDocument();
    expect(screen.getByText('当前会话已锁定空间范围')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建对话以更改/ })).toBeInTheDocument();
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

describe('Message input IME composition handling', () => {
  it('does not submit on Enter during IME composition', () => {
    const onSend = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(<MessageInput disabled={false} isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('消息');
    fireEvent.change(textarea, { target: { value: 'pin' } });
    fireTextareaKeyDown(textarea, { key: 'Enter', isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('submits normally on Enter after composition', async () => {
    const onSend = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(<MessageInput disabled={false} isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('消息');
    fireEvent.change(textarea, { target: { value: '完成输入' } });
    fireTextareaKeyDown(textarea, { key: 'Enter', isComposing: false });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('完成输入', expect.any(Object));
  });

  it('does not submit on Shift+Enter regardless of composition state', () => {
    const onSend = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(<MessageInput disabled={false} isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('消息');
    fireEvent.change(textarea, { target: { value: 'line one' } });
    fireTextareaKeyDown(textarea, { key: 'Enter', shiftKey: true, isComposing: false });
    fireTextareaKeyDown(textarea, { key: 'Enter', shiftKey: true, isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not submit on the Process key during composition', () => {
    const onSend = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(<MessageInput disabled={false} isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('消息');
    fireEvent.change(textarea, { target: { value: 'process key input' } });
    fireTextareaKeyDown(textarea, { key: 'Process' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not submit when keyCode is 229 (Safari IME fallback)', () => {
    const onSend = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(<MessageInput disabled={false} isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('消息');
    fireEvent.change(textarea, { target: { value: 'safari ime input' } });
    fireTextareaKeyDown(textarea, { key: 'Enter', keyCode: 229, isComposing: false });

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('Phase 3 chat controls and stream events', () => {
  it('sends selected space_ids when multiple spaces are selected', async () => {
    const fetchState = stubChatFetch({
      spaces: [
        { id: 'space-1', name: 'Space One' },
        { id: 'space-2', name: 'Space Two' },
      ],
      streamEvents: [{ event: 'message.completed', data: {} }],
    });

    renderChatRoute();

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '聊天空间' }));
    fireEvent.click(await screen.findByText('Space Two'));
    await sendChatMessage('compare both spaces');

    await waitFor(() =>
      expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({
        space_id: 'space-1',
        space_ids: ['space-1', 'space-2'],
      }),
    );
  });

  it('restores selected spaces when opening a multi-space session', async () => {
    stubChatFetch({
      sessions: [
        {
          id: 'session-multi',
          title: 'Multi-space chat',
          space_ids: ['space-1', 'space-2'],
          space_details: [
            { id: 'space-1', name: 'Space One' },
            { id: 'space-2', name: 'Space Two' },
          ],
          created_at: '2026-05-01T10:00:00.000Z',
          updated_at: '2026-05-01T11:00:00.000Z',
        },
      ],
      sessionDetails: {
        'session-multi': {
          id: 'session-multi',
          space_ids: ['space-1', 'space-2'],
          space_details: [
            { id: 'space-1', name: 'Space One' },
            { id: 'space-2', name: 'Space Two' },
          ],
          messages: [],
        },
      },
    });

    renderChatRoute();

    fireEvent.click(await screen.findByText('Multi-space chat'));

    expect(await screen.findByText('Space Two')).toBeInTheDocument();
    expect(screen.getByText('当前会话已锁定空间范围')).toBeInTheDocument();
  });

  it('locks the selector after a session starts', async () => {
    stubChatFetch({
      streamEvents: [
        { event: 'session', data: { session_id: 'session-started' } },
        { event: 'message.completed', data: {} },
      ],
    });

    renderChatRoute();
    await sendChatMessage('start a scoped session');

    expect(await screen.findByText('当前会话已锁定空间范围')).toBeInTheDocument();
    expect(document.querySelector('.chat-space-selector.ant-select-disabled')).toBeInTheDocument();
  });

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

function fireTextareaKeyDown(textarea: HTMLTextAreaElement, init: KeyboardEventInit): void {
  fireEvent(textarea, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
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

type StubSpace = {
  id: string;
  name: string;
};

type StubSession = {
  id: string;
  title: string | null;
  space_ids?: string[];
  space_details?: StubSpace[];
  created_at: string;
  updated_at: string;
};

type StubSessionDetail = {
  id: string;
  space_ids?: string[];
  space_details?: StubSpace[];
  messages: unknown[];
};

function stubChatFetch({
  databaseEnabled = false,
  spaces = [
    { id: 'space-1', name: 'Space One' },
    { id: 'space-2', name: 'Space Two' },
  ],
  sessions = [],
  sessionDetails = {},
  streamEvents = [],
}: {
  databaseEnabled?: boolean;
  spaces?: StubSpace[];
  sessions?: StubSession[];
  sessionDetails?: Record<string, StubSessionDetail>;
  streamEvents?: StreamEvent[];
} = {}): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => {
      const path = getRequestPath(input);
      calls.push({ path, body: parseRequestBody(init?.body) });

      if (path === '/api/spaces') {
        return Promise.resolve(
          jsonResponse({
            data: spaces.map((space) => ({ ...space, status: 'active' })),
            meta: { request_id: 'req-spaces' },
          }),
        );
      }

      if (path === '/api/spaces/space-1') {
        return Promise.resolve(jsonResponse({ data: { id: 'space-1', database_config: { enabled: databaseEnabled } } }));
      }

      if (path === '/api/spaces/space-1/chat/sessions' && init?.method !== 'POST') {
        return Promise.resolve(jsonResponse({ data: sessions, meta: { request_id: 'req-sessions' } }));
      }

      const sessionDetailMatch = path.match(/^\/api\/spaces\/space-1\/chat\/sessions\/([^/]+)$/);
      if (sessionDetailMatch !== null) {
        const detail = sessionDetails[decodeURIComponent(sessionDetailMatch[1] ?? '')];
        return Promise.resolve(
          detail !== undefined
            ? jsonResponse({ data: detail, meta: { request_id: 'req-session-detail' } })
            : jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404),
        );
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
