// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthUser } from '../lib/auth.js';
import Chat, { ChatMessageBubble, MessageInput, SessionSidebar } from '../pages/Chat.js';
import { CHAT_INPUT_MAX_LENGTH, ChatStreamError, type ChatCitation, type ChatMessage } from '../hooks/useChatStream.js';

const testUser: AuthUser = {
  id: 'user-1',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
  groups: [],
  spaces: [{ id: 'space-1', name: 'Space One', role: 'viewer' }],
};

afterEach(() => {
  cleanup();
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

    expect(screen.getAllByRole('button', { name: /Latest chat/ })[0]).toHaveClass('active');
    expect(screen.getByText('Chat session-')).toBeInTheDocument();
  });
});

describe('Message input', () => {
  it('enforces the 4000 character limit', async () => {
    const onSend = vi.fn<(message: string) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(<MessageInput disabled={false} isStreaming={false} onSend={onSend} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(CHAT_INPUT_MAX_LENGTH + 25) } });

    expect(textarea.value).toHaveLength(CHAT_INPUT_MAX_LENGTH);
    expect(screen.getByText(`${CHAT_INPUT_MAX_LENGTH}/${CHAT_INPUT_MAX_LENGTH}`)).toHaveClass('warning');

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[0]).toHaveLength(CHAT_INPUT_MAX_LENGTH);
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

    const textarea = await screen.findByLabelText('Message');
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
    citations: [],
    usage: null,
    created_at: '2026-05-01T10:00:00.000Z',
    status: 'complete',
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

function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input.split('?')[0] ?? input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return input.url.split('?')[0] ?? input.url;
}
