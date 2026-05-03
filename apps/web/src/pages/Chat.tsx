import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Navigate, useNavigate, useParams } from 'react-router';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import SpaceNav from '../components/SpaceNav.js';
import { EmptyState, ErrorBanner, LoadingState, formatDate, getErrorMessage } from '../components/adminUi.js';
import {
  CHAT_INPUT_MAX_LENGTH,
  getChatErrorMessage,
  useChatStream,
  type ChatApiSessionDetail,
  type ChatCitation,
  type ChatMessage,
} from '../hooks/useChatStream.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import NotFound from './NotFound.js';

type ChatSession = {
  id: string;
  title: string | null;
  updated_at: string;
  created_at: string;
};

type MessageInputProps = {
  disabled: boolean;
  isStreaming: boolean;
  onSend: (message: string) => Promise<void> | void;
};

type SessionSidebarProps = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (session: ChatSession) => void;
};

type ChatMessageBubbleProps = {
  message: ChatMessage;
  spaceId: string;
};

export default function Chat() {
  const { spaceId = '' } = useParams();
  const { accessToken, hasSpacePermission, isAuthenticated, user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(
    async (background = false) => {
      if (!isAuthenticated || spaceId.length === 0) {
        setSessions([]);
        setSessionsLoading(false);
        return;
      }

      if (!background) {
        setSessionsLoading(true);
      }
      setSessionsError(null);

      try {
        const response = await api.getWrapped<ChatSession[]>(
          `/spaces/${encodeURIComponent(spaceId)}/chat/sessions`,
          {
            page: 1,
            limit: 50,
          },
        );
        setSessions(sortSessions(response.data));
      } catch (err) {
        setSessionsError(getErrorMessage(err));
      } finally {
        if (!background) {
          setSessionsLoading(false);
        }
      }
    },
    [isAuthenticated, spaceId],
  );

  const {
    messages,
    sessionId,
    isStreaming,
    error: streamError,
    sendMessage,
    retry,
    loadSession,
    startNewSession,
  } = useChatStream({
    spaceId,
    accessToken,
    onSession: () => {
      void loadSessions(true);
    },
  });

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (spaceId.length === 0) {
    return <NotFound />;
  }

  if (!hasSpacePermission(spaceId, 'chat:use')) {
    return (
      <main className="forbidden-page">
        <section className="forbidden-panel">
          <p className="eyebrow">403</p>
          <h1>Access denied</h1>
          <p>{user?.email ?? 'This user'} does not have chat access for this space.</p>
        </section>
      </main>
    );
  }

  async function openSession(nextSessionId: string): Promise<void> {
    setSessionsError(null);
    setIsMobileSidebarOpen(false);

    try {
      const detail = await api.get<ChatApiSessionDetail>(
        `/spaces/${encodeURIComponent(spaceId)}/chat/sessions/${encodeURIComponent(nextSessionId)}`,
      );
      loadSession(detail);
    } catch (err) {
      setSessionsError(getErrorMessage(err));
    }
  }

  async function deleteSession(session: ChatSession): Promise<void> {
    if (!window.confirm(`Delete chat "${getSessionTitle(session)}"?`)) {
      return;
    }

    setSessionsError(null);

    try {
      await api.delete<{ deleted: true }>(
        `/spaces/${encodeURIComponent(spaceId)}/chat/sessions/${encodeURIComponent(session.id)}`,
      );
      setSessions((current) => current.filter((item) => item.id !== session.id));
      if (session.id === sessionId) {
        startNewSession();
      }
    } catch (err) {
      setSessionsError(getErrorMessage(err));
    }
  }

  function newChat(): void {
    startNewSession();
    setIsMobileSidebarOpen(false);
  }

  async function handleSend(message: string): Promise<void> {
    await sendMessage(message, { sessionId });
    await loadSessions(true);
  }

  const chatErrorMessage = getChatErrorMessage(streamError);

  return (
    <div className="chat-page">
      {isMobileSidebarOpen ? (
        <button
          className="chat-sidebar-backdrop"
          type="button"
          aria-label="Close sessions"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      ) : null}

      <aside className={`chat-session-sidebar${isMobileSidebarOpen ? ' open' : ''}`} aria-label="Chat sessions">
        <div className="chat-sidebar-header">
          <div>
            <span className="eyebrow">Space</span>
            <strong>Cherry Chat</strong>
          </div>
          <button className="icon-button chat-sidebar-close" type="button" onClick={() => setIsMobileSidebarOpen(false)}>
            x
          </button>
        </div>
        <SpaceNav spaceId={spaceId} />
        <ErrorBanner error={sessionsError} />
        <SessionSidebar
          sessions={sessions}
          activeSessionId={sessionId}
          isLoading={sessionsLoading}
          onNewChat={newChat}
          onSelectSession={(nextSessionId) => {
            void openSession(nextSessionId);
          }}
          onDeleteSession={(session) => {
            void deleteSession(session);
          }}
        />
      </aside>

      <main className="chat-main">
        <header className="chat-topbar">
          <button className="button button-secondary chat-mobile-menu" type="button" onClick={() => setIsMobileSidebarOpen(true)}>
            Menu
          </button>
          <div>
            <span className="eyebrow">Knowledge Chat</span>
            <h1>Chat</h1>
          </div>
          <SpaceNav spaceId={spaceId} />
        </header>

        <section className="chat-message-list" aria-label="Chat messages">
          {messages.length === 0 ? (
            <EmptyState label="开始新的对话" />
          ) : (
            messages.map((message) => <ChatMessageBubble key={message.id} message={message} spaceId={spaceId} />)
          )}
          <div ref={messagesEndRef} />
        </section>

        {chatErrorMessage !== null ? (
          <div className="chat-error-bar" role="alert">
            <span>{chatErrorMessage}</span>
            {streamError?.code !== 'NO_CHAT_MODEL_CONFIGURED' ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={isStreaming}
                onClick={() => {
                  void retry();
                }}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <MessageInput disabled={isStreaming} isStreaming={isStreaming} onSend={handleSend} />
      </main>
    </div>
  );
}

export function MessageInput({ disabled, isStreaming, onSend }: MessageInputProps) {
  const [value, setValue] = useState('');
  const trimmedLength = value.trim().length;
  const isAtLimit = value.length >= CHAT_INPUT_MAX_LENGTH;

  async function submit(): Promise<void> {
    if (disabled || trimmedLength === 0 || value.length > CHAT_INPUT_MAX_LENGTH) {
      return;
    }

    const message = value;
    setValue('');
    await onSend(message);
  }

  return (
    <form
      className="chat-input-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="chat-message-input">Message</label>
      <textarea
        id="chat-message-input"
        value={value}
        maxLength={CHAT_INPUT_MAX_LENGTH}
        rows={3}
        disabled={disabled}
        placeholder={isStreaming ? 'Streaming response...' : 'Ask about this space'}
        onChange={(event) => setValue(event.target.value.slice(0, CHAT_INPUT_MAX_LENGTH))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="chat-input-footer">
        <span className={`chat-character-count${isAtLimit ? ' warning' : ''}`}>
          {value.length}/{CHAT_INPUT_MAX_LENGTH}
        </span>
        {isStreaming ? <span className="chat-stream-label">Streaming...</span> : null}
        <button className="button button-primary" type="submit" disabled={disabled || trimmedLength === 0}>
          Send
        </button>
      </div>
    </form>
  );
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  isLoading,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: SessionSidebarProps) {
  return (
    <div className="chat-session-list-panel">
      <button className="button button-primary chat-new-button" type="button" onClick={onNewChat}>
        New Chat
      </button>
      {isLoading ? (
        <LoadingState label="Loading sessions..." />
      ) : sessions.length === 0 ? (
        <EmptyState label="开始新的对话" />
      ) : (
        <ol className="chat-session-list">
          {sessions.map((session) => {
            const title = getSessionTitle(session);
            return (
              <li key={session.id}>
                <button
                  className={`chat-session-item${session.id === activeSessionId ? ' active' : ''}`}
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                >
                  <strong>{title}</strong>
                  <span>{formatDate(session.updated_at)}</span>
                </button>
                <button
                  className="icon-button chat-session-delete"
                  type="button"
                  aria-label={`Delete ${title}`}
                  onClick={() => onDeleteSession(session)}
                >
                  x
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function ChatMessageBubble({ message, spaceId }: ChatMessageBubbleProps) {
  return (
    <article className={`chat-message-row ${message.role}`} aria-label={`${message.role} message`}>
      <div className={`chat-message-bubble ${message.role}`}>
        {message.role === 'assistant' ? (
          <>
            {message.status === 'streaming' && message.content.length === 0 ? (
              <TypingIndicator />
            ) : (
              <AssistantMarkdown content={message.content} citations={message.citations} spaceId={spaceId} />
            )}
            <CitationPanel citations={message.citations} spaceId={spaceId} />
          </>
        ) : (
          <p className="chat-user-content">{message.content}</p>
        )}
        {message.status === 'error' ? <p className="chat-message-error">{message.error ?? '响应中断，请重试'}</p> : null}
      </div>
    </article>
  );
}

function AssistantMarkdown({ content, citations, spaceId }: { content: string; citations: ChatCitation[]; spaceId: string }) {
  const navigate = useNavigate();
  const markdown = useMemo(() => content.replace(/\[\^(\d+)]/g, '[$1](citation:$1)'), [content]);

  function openCitation(index: number): void {
    const citation = citations.find((item) => item.index === index);
    if (citation === undefined) {
      return;
    }

    void navigate(buildCitationPath(spaceId, citation));
  }

  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={transformMarkdownUrl}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('citation:') === true) {
              const index = Number(href.slice('citation:'.length));
              return (
                <button className="chat-citation-ref" type="button" onClick={() => openCitation(index)}>
                  [{Number.isFinite(index) ? index : children}]
                </button>
              );
            }

            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img: (props) => <img {...props} referrerPolicy="no-referrer" loading="lazy" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function CitationPanel({ citations, spaceId }: { citations: ChatCitation[]; spaceId: string }) {
  const navigate = useNavigate();

  if (citations.length === 0) {
    return null;
  }

  return (
    <details className="chat-citations" open>
      <summary>Citations ({citations.length})</summary>
      <ol>
        {citations.map((citation) => (
          <li key={`${citation.index}-${citation.chunk_id || citation.wiki_page_pk}`}>
            <button
              className="chat-citation-card"
              type="button"
              onClick={() => {
                void navigate(buildCitationPath(spaceId, citation));
              }}
            >
              <span className="chat-citation-index">[{citation.index}]</span>
              <span>
                <strong>{citation.page_title}</strong>
                <small>{citation.section_title ?? 'No section'}</small>
              </span>
              <span className="status-badge status-neutral">{formatCitationScore(citation.relevance_score)}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

function TypingIndicator() {
  return (
    <div className="chat-typing-indicator" aria-label="Assistant is typing">
      <span />
      <span />
      <span />
    </div>
  );
}

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
}

function getSessionTitle(session: ChatSession): string {
  if (session.title !== null && session.title.trim().length > 0) {
    return session.title;
  }

  return `Chat ${session.id.slice(0, 8)}`;
}

function buildCitationPath(spaceId: string, citation: ChatCitation): string {
  return `/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(getCitationPageId(citation))}`;
}

export function getCitationPageId(citation: ChatCitation): string {
  const sourcePageId = citation.source_chain_json.page_id;
  return typeof sourcePageId === 'string' && sourcePageId.length > 0 ? sourcePageId : citation.wiki_page_pk;
}

function formatCitationScore(score: number): string {
  if (!Number.isFinite(score)) {
    return '0.00';
  }

  if (score >= 0 && score <= 1) {
    return `${Math.round(score * 100)}%`;
  }

  return score.toFixed(2);
}

function transformMarkdownUrl(url: string): string {
  if (url.startsWith('citation:')) {
    return url;
  }

  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:')) {
    return url;
  }

  return '';
}
