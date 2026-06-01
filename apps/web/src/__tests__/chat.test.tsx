// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { message as antdMessage } from 'antd';
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
  window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
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

    fireEvent.mouseDown(getSpaceSelectorCombobox());
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

  it('does not lock selection when not streaming', () => {
    renderWithRouter(
      <SpaceSelector
        availableSpaces={[{ id: 'space-1', name: 'Space One' }]}
        selectedSpaceIds={['space-1']}
        primarySpaceId="space-1"
        locked={false}
        onChange={vi.fn()}
        onStartNewSession={vi.fn()}
      />,
    );

    expect(document.querySelector('.chat-space-selector.ant-select-disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('当前会话已锁定空间范围')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /新建对话以更改/ })).not.toBeInTheDocument();
  });

  it('locks selection while streaming', () => {
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

  it('disables unselected options after selecting 10 spaces', async () => {
    renderWithRouter(
      <SpaceSelector
        availableSpaces={Array.from({ length: 11 }, (_, index) => ({
          id: `space-${index + 1}`,
          name: `Space ${index + 1}`,
        }))}
        selectedSpaceIds={Array.from({ length: 10 }, (_, index) => `space-${index + 1}`)}
        primarySpaceId="space-1"
        locked={false}
        onChange={vi.fn()}
        onStartNewSession={vi.fn()}
      />,
    );

    fireEvent.mouseDown(getSpaceSelectorCombobox());

    const extraOption = await screen.findByTitle('Space 11');
    expect(extraOption.closest('.ant-select-item-option-disabled')).not.toBeNull();
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

describe('Chat bottom area layout', () => {
  it('wraps space selector and message input in chat-bottom-area container', async () => {
    stubChatFetch();

    renderChatRoute();

    await screen.findByLabelText('消息');
    const bottomArea = document.querySelector('.chat-bottom-area');
    expect(bottomArea).toBeInTheDocument();
    expect(bottomArea?.querySelector('.chat-space-selector-panel')).toBeInTheDocument();
    expect(bottomArea?.querySelector('.chat-input-panel')).toBeInTheDocument();
  });

  it('renders forbidden and skips protected chat requests when route space lacks permissions', async () => {
    const fetchState = stubChatFetch();

    renderChatRoute({
      ...testUser,
      email: 'denied@example.com',
      spaces: [{ id: 'space-allowed', name: 'Allowed Space', role: 'viewer' }],
    }, '/spaces/space-denied/chat');

    expect(await screen.findByText('无权访问')).toBeInTheDocument();
    expect(fetchState.calls).toHaveLength(0);
    expect(screen.queryByLabelText('消息')).not.toBeInTheDocument();
  });
});

describe('Chat model availability pre-check', () => {
  it('shows a no-model banner and disables input when chat models are unavailable', async () => {
    stubChatFetch({ chatModelAvailable: false });

    renderChatRoute();

    expect(await screen.findByText('请联系管理员配置聊天模型')).toBeInTheDocument();
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('消息');
    expect(textarea).toBeDisabled();
    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled();
  });

  it('shows no no-model banner and keeps input enabled when chat models are available', async () => {
    stubChatFetch({ chatModelAvailable: true });

    renderChatRoute();

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>('消息');
    await waitFor(() => expect(screen.queryByText('请联系管理员配置聊天模型')).not.toBeInTheDocument());
    expect(textarea).not.toBeDisabled();
  });

  it('shows no no-model banner and keeps input enabled when the availability API fails', async () => {
    stubChatFetch({ chatModelAvailableStatus: 500 });

    renderChatRoute();

    const textarea = await screen.findByLabelText<HTMLTextAreaElement>('消息');
    await waitFor(() => expect(screen.queryByText('请联系管理员配置聊天模型')).not.toBeInTheDocument());
    expect(textarea).not.toBeDisabled();
  });
});

describe('Sidebar collapse', () => {
  it('renders collapse toggle button in sidebar header', async () => {
    stubChatFetch();

    renderChatRoute();

    const collapseButton = await screen.findByRole('button', { name: '收起侧边栏' });
    fireEvent.click(collapseButton);

    await waitFor(() => expect(document.querySelector('.chat-page')).toHaveClass('sidebar-collapsed'));
  });

  it('persists sidebar collapsed state to localStorage', async () => {
    const localStorageMock = stubLocalStorage({ 'cherry-chat-sidebar-collapsed': 'true' });
    stubChatFetch();

    renderChatRoute();

    await waitFor(() => expect(document.querySelector('.chat-page')).toHaveClass('sidebar-collapsed'));
    localStorageMock.clear();
    fireEvent.click(await screen.findByRole('button', { name: '展开侧边栏' }));

    await waitFor(() => {
      expect(document.querySelector('.chat-page')).not.toHaveClass('sidebar-collapsed');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(localStorageMock.setItem).toHaveBeenLastCalledWith('cherry-chat-sidebar-collapsed', 'false');
    });
  });

  it('shows floating expand button when sidebar is collapsed', async () => {
    stubLocalStorage({ 'cherry-chat-sidebar-collapsed': 'true' });
    stubChatFetch();

    renderChatRoute();

    const expandButton = await screen.findByRole('button', { name: '展开侧边栏' });
    expect(expandButton).toHaveClass('chat-sidebar-expand');
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '展开侧边栏' })).not.toBeInTheDocument();
      expect(document.querySelector('.chat-page')).not.toHaveClass('sidebar-collapsed');
    });
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
    expect(screen.queryByText('当前会话已锁定空间范围')).not.toBeInTheDocument();
    expect(document.querySelector('.chat-space-selector.ant-select-disabled')).not.toBeInTheDocument();
  });

  it('keeps the selector editable after a session starts', async () => {
    stubChatFetch({
      streamEvents: [
        { event: 'session', data: { session_id: 'session-started' } },
        { event: 'message.completed', data: {} },
      ],
    });

    renderChatRoute();
    await sendChatMessage('start a scoped session');

    await waitFor(() => expect(screen.queryByText('当前会话已锁定空间范围')).not.toBeInTheDocument());
    expect(document.querySelector('.chat-space-selector.ant-select-disabled')).not.toBeInTheDocument();
  });

  it('rolls back selected spaces when updating an existing session fails', async () => {
    const errorSpy = vi.spyOn(antdMessage, 'error').mockReturnValue(undefined as never);
    const fetchState = stubChatFetch({
      patchSessionSpacesStatus: 500,
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
      streamEvents: [{ event: 'message.completed', data: {} }],
    });

    renderChatRoute();
    fireEvent.click(await screen.findByText('Multi-space chat'));
    expect(await screen.findByText('Space Two')).toBeInTheDocument();

    const closeButton = document.querySelector('.chat-space-selector .ant-tag-close-icon');
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton!);

    await waitFor(() =>
      expect(fetchState.calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/api/spaces/space-1/chat/sessions/session-multi',
            body: { space_ids: ['space-1'] },
          }),
        ]),
      ),
    );
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('更新聊天范围失败'));

    await sendChatMessage('continue with original scope');

    await waitFor(() =>
      expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({
        session_id: 'session-multi',
        space_ids: ['space-1', 'space-2'],
      }),
    );
  });

  it('persists selected spaces and refreshes sessions when updating an existing session succeeds', async () => {
    const fetchState = stubChatFetch({
      sessions: [
        {
          id: 'session-single',
          title: 'Single-space chat',
          space_ids: ['space-1'],
          space_details: [{ id: 'space-1', name: 'Space One' }],
          created_at: '2026-05-01T10:00:00.000Z',
          updated_at: '2026-05-01T11:00:00.000Z',
        },
      ],
      sessionDetails: {
        'session-single': {
          id: 'session-single',
          space_ids: ['space-1'],
          space_details: [{ id: 'space-1', name: 'Space One' }],
          messages: [],
        },
      },
      streamEvents: [{ event: 'message.completed', data: {} }],
    });

    renderChatRoute();
    fireEvent.click(await screen.findByText('Single-space chat'));

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '聊天空间' }));
    fireEvent.click(await screen.findByText('Space Two'));

    await waitFor(() =>
      expect(fetchState.calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/api/spaces/space-1/chat/sessions/session-single',
            body: { space_ids: ['space-1', 'space-2'] },
          }),
        ]),
      ),
    );

    const sessionListFetches = fetchState.calls.filter((call) => call.path === '/api/spaces/space-1/chat/sessions');
    expect(sessionListFetches.length).toBeGreaterThanOrEqual(2);

    await sendChatMessage('continue with expanded scope');
    await waitFor(() =>
      expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({
        session_id: 'session-single',
        space_ids: ['space-1', 'space-2'],
      }),
    );
  });

  it('deleting the active session removes it and resets the chat scope to the route space', async () => {
    const fetchState = stubChatFetch({
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
      streamEvents: [{ event: 'message.completed', data: {} }],
    });

    renderChatRoute();
    fireEvent.click(await screen.findByText('Multi-space chat'));
    expect(await screen.findByText('Space Two')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除 Multi-space chat' }));
    await waitFor(() => {
      const popoverButtons = document.querySelectorAll('.ant-popconfirm .ant-btn-primary');
      expect(popoverButtons.length).toBeGreaterThan(0);
      fireEvent.click(popoverButtons[0] as HTMLElement);
    });

    await waitFor(() =>
      expect(fetchState.calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/api/spaces/space-1/chat/sessions/session-multi',
            body: null,
          }),
        ]),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Multi-space chat')).not.toBeInTheDocument());

    await sendChatMessage('start after delete');
    await waitFor(() =>
      expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({
        space_ids: ['space-1'],
      }),
    );
    expect(getLastChatCompletionBody(fetchState.calls)).not.toHaveProperty('session_id');
  });

  it('new chat resets selected spaces to the route space', async () => {
    const fetchState = stubChatFetch({
      streamEvents: [{ event: 'message.completed', data: {} }],
    });

    renderChatRoute();
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '聊天空间' }));
    fireEvent.click(await screen.findByText('Space Two'));
    expect(await screen.findByText(/已选择 2 个空间/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /新建对话/ }));
    await waitFor(() => expect(screen.queryByText(/已选择 2 个空间/)).not.toBeInTheDocument());

    await sendChatMessage('single space after new chat');
    await waitFor(() =>
      expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({
        space_ids: ['space-1'],
      }),
    );
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

  it('hides the database toggle and sends no enable_database flag when multiple spaces are selected', async () => {
    const fetchState = stubChatFetch({
      databaseEnabled: true,
      streamEvents: [{ event: 'message.completed', data: {} }],
    });

    renderChatRoute();

    await waitFor(() =>
      expect(fetchState.calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/api/spaces/space-1',
          }),
        ]),
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: '数据库' }, { timeout: 5000 }));
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '聊天空间' }));
    fireEvent.click(await screen.findByText('Space Two'));

    await waitFor(() => expect(screen.queryByRole('button', { name: '数据库' })).not.toBeInTheDocument());
    await sendChatMessage('multi-space disables database');

    await waitFor(() => expect(getLastChatCompletionBody(fetchState.calls)).not.toHaveProperty('enable_database'));
    expect(getLastChatCompletionBody(fetchState.calls)).toMatchObject({
      space_ids: ['space-1', 'space-2'],
    });
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

    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>('消息')).not.toBeDisabled());
    const selectWrapper = await screen.findByText('检索模式');
    const selectTrigger = selectWrapper.closest('.chat-retrieval-mode-label')?.querySelector<HTMLElement>('.ant-select-selector');
    expect(selectTrigger).not.toBeNull();
    fireEvent.mouseDown(selectTrigger!);
    const pathOption = await screen.findByText('路径优先');
    fireEvent.click(pathOption);

    expect(await screen.findByText('Agent')).toBeInTheDocument();
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

        if (path === '/api/models/chat-available') {
          return Promise.resolve(jsonResponse({ data: { available: true }, meta: { request_id: 'req-chat-model' } }));
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

function renderChatRoute(user: AuthUser = testUser, path = '/spaces/space-1/chat'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={{ user, accessToken: 'test-token' }}>
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

function getSpaceSelectorCombobox(): HTMLInputElement {
  const combobox = document.querySelector<HTMLInputElement>('.chat-space-selector input[role="combobox"]');
  expect(combobox).not.toBeNull();
  return combobox!;
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
  chatModelAvailable = true,
  chatModelAvailableStatus = 200,
  spaces = [
    { id: 'space-1', name: 'Space One' },
    { id: 'space-2', name: 'Space Two' },
  ],
  sessions = [],
  sessionDetails = {},
  streamEvents = [],
  patchSessionSpacesStatus = 200,
}: {
  databaseEnabled?: boolean;
  chatModelAvailable?: boolean;
  chatModelAvailableStatus?: number;
  spaces?: StubSpace[];
  sessions?: StubSession[];
  sessionDetails?: Record<string, StubSessionDetail>;
  streamEvents?: StreamEvent[];
  patchSessionSpacesStatus?: number;
} = {}): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, init) => {
      const path = getRequestPath(input);
      const requestBody = parseRequestBody(init?.body);
      calls.push({ path, body: requestBody });

      if (path === '/api/models/chat-available') {
        return Promise.resolve(
          chatModelAvailableStatus >= 200 && chatModelAvailableStatus < 300
            ? jsonResponse({ data: { available: chatModelAvailable }, meta: { request_id: 'req-chat-model' } })
            : jsonResponse(
                { error: { code: 'INTERNAL_ERROR', message: 'Failed to check model availability' } },
                chatModelAvailableStatus,
              ),
        );
      }

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
      if (sessionDetailMatch !== null && init?.method === 'PATCH') {
        return Promise.resolve(
          patchSessionSpacesStatus >= 200 && patchSessionSpacesStatus < 300
            ? jsonResponse({
                data: {
                  session_id: decodeURIComponent(sessionDetailMatch[1] ?? ''),
                  space_ids: isRecord(requestBody) && Array.isArray(requestBody.space_ids) ? requestBody.space_ids : ['space-1'],
                  space_details: spaces,
                },
                meta: { request_id: 'req-patch-session-spaces' },
              })
            : jsonResponse(
                { error: { code: 'INTERNAL_ERROR', message: 'Failed to update chat scope' } },
                patchSessionSpacesStatus,
              ),
        );
      }

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

function stubLocalStorage(initial: Record<string, string> = {}): Storage {
  const store: Record<string, string> = { ...initial };
  const localStorageMock: Storage = {
    get length() {
      return Object.keys(store).length;
    },
    clear: vi.fn(() => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    }),
    getItem: vi.fn((key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] ?? null : null)),
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
  };

  vi.stubGlobal('localStorage', localStorageMock);
  return localStorageMock;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
