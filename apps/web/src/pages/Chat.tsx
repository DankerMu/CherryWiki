import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { Navigate, useNavigate, useParams } from 'react-router';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { Alert, Button, Collapse, Empty, List, Popconfirm, Result, Select, Spin, Tag } from 'antd';
import { CloseOutlined, DeleteOutlined, MenuOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import ChatChart from '../components/ChatChart.js';
import { ConfidenceBadge } from '../components/ConfidenceBadge.js';
import GraphPathViewer, { type GraphPathData, type GraphPathEdge, type GraphPathNode } from '../components/GraphPathViewer.js';
import { formatDate, getErrorMessage } from '../components/adminUi.js';
import {
  CHAT_INPUT_MAX_LENGTH,
  DEFAULT_RETRIEVAL_MODE,
  getChatErrorMessage,
  isAgentRetrievalMode,
  useChatStream,
  type ChatApiSessionDetail,
  type ChatCitation,
  type ChatMessage,
  type ChatMessagePart,
  type ChatToolUsePart,
  type RetrievalMode,
  type SendMessageOptions,
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
  onSend: (message: string, options: ChatSettings) => Promise<void> | void;
  settings?: ChatSettings;
  databaseAvailable?: boolean;
  onSettingsChange?: (settings: ChatSettings) => void;
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

type ChatSettings = {
  enableDeepAnalysis: boolean;
  enableDatabase: boolean;
  retrievalMode: RetrievalMode;
};

type ChatSpaceDetail = {
  database_config?: unknown;
};

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enableDeepAnalysis: false,
  enableDatabase: false,
  retrievalMode: DEFAULT_RETRIEVAL_MODE,
};

export default function Chat() {
  const { t } = useTranslation();
  const { spaceId = '' } = useParams();
  const { accessToken, hasSpacePermission, isAuthenticated, user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [spaceDatabaseEnabled, setSpaceDatabaseEnabled] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings>(() => loadChatSettings(spaceId));
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const sessionSwitchRef = useRef(0);

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
    setChatSettings(loadChatSettings(spaceId));
  }, [spaceId]);

  useEffect(() => {
    saveChatSettings(spaceId, chatSettings);
  }, [chatSettings, spaceId]);

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated || spaceId.length === 0) {
      setSpaceDatabaseEnabled(false);
      return () => {
        cancelled = true;
      };
    }

    api
      .get<ChatSpaceDetail>(`/spaces/${encodeURIComponent(spaceId)}`)
      .then((space) => {
        if (!cancelled) {
          setSpaceDatabaseEnabled(isSpaceDatabaseEnabled(space.database_config));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSpaceDatabaseEnabled(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, spaceId]);

  useEffect(() => {
    if (!spaceDatabaseEnabled && chatSettings.enableDatabase) {
      setChatSettings((current) => ({ ...current, enableDatabase: false }));
    }
  }, [chatSettings.enableDatabase, spaceDatabaseEnabled]);

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
      <Result
        status="403"
        title={t('chat.forbidden.title')}
        subTitle={t('chat.forbidden.description', { email: user?.email ?? '' })}
      />
    );
  }

  async function openSession(nextSessionId: string): Promise<void> {
    setSessionsError(null);
    setIsMobileSidebarOpen(false);
    const switchVersion = ++sessionSwitchRef.current;

    try {
      const detail = await api.get<ChatApiSessionDetail>(
        `/spaces/${encodeURIComponent(spaceId)}/chat/sessions/${encodeURIComponent(nextSessionId)}`,
      );
      if (sessionSwitchRef.current !== switchVersion) return;
      loadSession(detail);
    } catch (err) {
      if (sessionSwitchRef.current !== switchVersion) return;
      setSessionsError(getErrorMessage(err));
    }
  }

  async function executeDeleteSession(session: ChatSession): Promise<void> {
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

  async function handleSend(message: string, settings: ChatSettings): Promise<void> {
    const options: SendMessageOptions = {
      sessionId,
      enableDeepAnalysis: settings.enableDeepAnalysis,
      enableDatabase: spaceDatabaseEnabled && settings.enableDatabase,
      retrievalMode: settings.retrievalMode,
    };

    await sendMessage(message, options);
    await loadSessions(true);
  }

  const chatErrorMessage = getChatErrorMessage(streamError);

  return (
    <div className="chat-page">
      {isMobileSidebarOpen ? (
        <button
          className="chat-sidebar-backdrop"
          type="button"
          aria-label={t('chat.closeSessions')}
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      ) : null}

      <aside className={`chat-session-sidebar${isMobileSidebarOpen ? ' open' : ''}`} aria-label={t('chat.title')}>
        <div className="chat-sidebar-header">
          <div>
            <span className="eyebrow">{t('chat.space')}</span>
            <strong>{t('chat.brand')}</strong>
          </div>
          <Button
            type="text"
            icon={<CloseOutlined />}
            className="chat-sidebar-close"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-label={t('chat.closeSidebar')}
          />
        </div>
        {sessionsError !== null ? <Alert type="error" message={sessionsError} showIcon style={{ margin: '0 8px 8px' }} /> : null}
        <SessionSidebar
          sessions={sessions}
          activeSessionId={sessionId}
          isLoading={sessionsLoading}
          onNewChat={newChat}
          onSelectSession={(nextSessionId) => {
            void openSession(nextSessionId);
          }}
          onDeleteSession={(session) => {
            void executeDeleteSession(session);
          }}
        />
      </aside>

      <main className="chat-main">
        <header className="chat-topbar">
          <Button
            icon={<MenuOutlined />}
            className="chat-mobile-menu"
            onClick={() => setIsMobileSidebarOpen(true)}
          >
            {t('chat.menu')}
          </Button>
          <div>
            <span className="eyebrow">{t('chat.knowledgeChat')}</span>
            <h1>{t('chat.title')}</h1>
          </div>
        </header>

        <section className="chat-message-list" aria-label={t('chat.messagesLabel')}>
          {messages.length === 0 ? (
            <Empty description={t('chat.emptyConversation')} />
          ) : (
            messages.map((message) => <ChatMessageBubble key={message.id} message={message} spaceId={spaceId} />)
          )}
          <div ref={messagesEndRef} />
        </section>

        {chatErrorMessage !== null ? (
          <div className="chat-error-bar" role="alert">
            <span>{chatErrorMessage}</span>
            {streamError?.code !== 'NO_CHAT_MODEL_CONFIGURED' ? (
              <Button
                type="default"
                disabled={isStreaming}
                onClick={() => {
                  void retry();
                }}
              >
                {t('common.action.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <MessageInput
          disabled={isStreaming}
          isStreaming={isStreaming}
          settings={chatSettings}
          databaseAvailable={spaceDatabaseEnabled}
          onSettingsChange={setChatSettings}
          onSend={handleSend}
        />
      </main>
    </div>
  );
}

export function MessageInput({
  disabled,
  isStreaming,
  onSend,
  settings = DEFAULT_CHAT_SETTINGS,
  databaseAvailable = false,
  onSettingsChange,
}: MessageInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const trimmedLength = value.trim().length;
  const isAtLimit = value.length >= CHAT_INPUT_MAX_LENGTH;
  const agentPathSelected =
    settings.enableDeepAnalysis || (databaseAvailable && settings.enableDatabase) || isAgentRetrievalMode(settings.retrievalMode);

  const retrievalModeOptions: { value: RetrievalMode; label: string }[] = useMemo(
    () => [
      { value: 'wiki_only', label: t('chat.retrievalAuto') },
      { value: 'graph_rag', label: t('chat.retrievalGraph') },
      { value: 'path_first', label: t('chat.retrievalPath') },
      { value: 'community_first', label: t('chat.retrievalCommunity') },
    ],
    [t],
  );

  async function submit(): Promise<void> {
    if (disabled || trimmedLength === 0 || value.length > CHAT_INPUT_MAX_LENGTH) {
      return;
    }

    const message = value;
    setValue('');
    await onSend(message, {
      ...settings,
      enableDatabase: databaseAvailable && settings.enableDatabase,
    });
  }

  function updateSettings(patch: Partial<ChatSettings>): void {
    onSettingsChange?.({
      ...settings,
      ...patch,
    });
  }

  const deepAnalysisSegmentOptions = useMemo(() => {
    const opts = [
      { label: t('chat.deepAnalysis'), value: 'deepAnalysis' },
    ];
    if (databaseAvailable) {
      opts.push({ label: t('chat.database'), value: 'database' });
    }
    return opts;
  }, [t, databaseAvailable]);

  const segmentedValue = useMemo(() => {
    const active: string[] = [];
    if (settings.enableDeepAnalysis) active.push('deepAnalysis');
    if (databaseAvailable && settings.enableDatabase) active.push('database');
    return active;
  }, [settings.enableDeepAnalysis, settings.enableDatabase, databaseAvailable]);

  return (
    <form
      className="chat-input-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="chat-message-input">{t('chat.messageLabel')}</label>
      <textarea
        id="chat-message-input"
        value={value}
        maxLength={CHAT_INPUT_MAX_LENGTH}
        rows={3}
        disabled={disabled}
        placeholder={isStreaming ? t('chat.streamingPlaceholder') : t('chat.inputPlaceholder')}
        onChange={(event) => setValue(event.target.value.slice(0, CHAT_INPUT_MAX_LENGTH))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="chat-input-settings" aria-label={t('chat.retrievalModeLabel')}>
        {deepAnalysisSegmentOptions.map((opt) => {
          const isActive = segmentedValue.includes(opt.value);
          return (
            <button
              key={opt.value}
              className={`chat-toggle-chip${isActive ? ' active' : ''}`}
              type="button"
              aria-pressed={isActive}
              disabled={disabled}
              onClick={() => {
                if (opt.value === 'deepAnalysis') {
                  updateSettings({ enableDeepAnalysis: !settings.enableDeepAnalysis });
                } else {
                  updateSettings({ enableDatabase: !settings.enableDatabase });
                }
              }}
            >
              {opt.label}
            </button>
          );
        })}
        <label className="chat-retrieval-mode-label" htmlFor="chat-retrieval-mode">
          {t('chat.retrievalModeLabel')}
          <Select
            id="chat-retrieval-mode"
            size="small"
            value={settings.retrievalMode}
            disabled={disabled}
            options={retrievalModeOptions}
            onChange={(nextMode) => updateSettings({ retrievalMode: normalizeRetrievalMode(nextMode) })}
            style={{ minWidth: 120 }}
            popupMatchSelectWidth={false}
          />
        </label>
        {agentPathSelected ? <Tag color="blue">{t('chat.agentLabel')}</Tag> : null}
      </div>
      <div className="chat-input-footer">
        <span className={`chat-character-count${isAtLimit ? ' warning' : ''}`}>
          {value.length}/{CHAT_INPUT_MAX_LENGTH}
        </span>
        {isStreaming ? <span className="chat-stream-label">{t('chat.streaming')}</span> : null}
        <Button type="primary" htmlType="submit" disabled={disabled || trimmedLength === 0} icon={<SendOutlined />}>
          {t('chat.send')}
        </Button>
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
  const { t } = useTranslation();

  return (
    <div className="chat-session-list-panel">
      <Button type="primary" icon={<PlusOutlined />} className="chat-new-button" block onClick={onNewChat}>
        {t('chat.newChat')}
      </Button>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin tip={t('chat.loadingSessions')} />
        </div>
      ) : sessions.length === 0 ? (
        <Empty description={t('chat.emptyConversation')} />
      ) : (
        <List
          className="chat-session-list"
          dataSource={sessions}
          renderItem={(session) => {
            const title = getSessionTitle(session);
            return (
              <List.Item
                className={`chat-session-item${session.id === activeSessionId ? ' active' : ''}`}
                onClick={() => onSelectSession(session.id)}
                actions={[
                  <Popconfirm
                    key="delete"
                    title={t('chat.deleteConfirm', { title })}
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      onDeleteSession(session);
                    }}
                    onCancel={(e) => e?.stopPropagation()}
                    okText={t('common.action.confirm')}
                    cancelText={t('common.action.cancel')}
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={`${t('common.action.delete')} ${title}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={title}
                  description={formatDate(session.updated_at)}
                />
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

export function ChatMessageBubble({ message, spaceId }: ChatMessageBubbleProps) {
  const { t } = useTranslation();

  return (
    <article className={`chat-message-row ${message.role}`} aria-label={`${message.role} message`}>
      <div className={`chat-message-bubble ${message.role}`}>
        {message.role === 'assistant' ? (
          <>
            {message.agentThinking ? (
              <AgentThinkingIndicator />
            ) : message.status === 'streaming' && message.content.length === 0 && message.parts.length === 0 ? (
              <TypingIndicator />
            ) : (
              message.content.length > 0 ? (
                <AssistantMarkdown content={message.content} citations={message.citations} spaceId={spaceId} />
              ) : null
            )}
            <ChatMessageParts parts={message.parts} />
            <CitationPanel citations={message.citations} spaceId={spaceId} />
            <CompletionIndicator message={message} />
          </>
        ) : (
          <p className="chat-user-content">{message.content}</p>
        )}
        {message.status === 'error' ? <p className="chat-message-error">{message.error ?? t('chat.responseInterrupted')}</p> : null}
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
              const citation = Number.isFinite(index) ? citations.find((item) => item.index === index) : undefined;
              return (
                <>
                  <button className="chat-citation-ref" type="button" onClick={() => openCitation(index)}>
                    [{Number.isFinite(index) ? index : children}]
                  </button>
                  <ConfidenceBadge label={citation !== undefined ? getCitationConfidenceLabel(citation) : null} />
                </>
              );
            }

            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img: () => null,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function CitationPanel({ citations, spaceId }: { citations: ChatCitation[]; spaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (citations.length === 0) {
    return null;
  }

  const collapseItems = [
    {
      key: 'citations',
      label: t('chat.citations', { count: citations.length }),
      children: (
        <ol className="chat-citation-ol">
          {citations.map((citation) => {
            const graphEdgeIds = getCitationStringArray(citation, 'graph_edge_ids');
            const graphPath = getCitationGraphPath(citation);
            return (
              <li key={`${citation.index}-${citation.chunk_id || citation.wiki_page_pk}`}>
                <div className="chat-citation-entry">
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
                      <small>{citation.section_title ?? t('chat.noSection')}</small>
                    </span>
                    <ConfidenceBadge label={getCitationConfidenceLabel(citation)} />
                    <Tag>{formatCitationScore(citation.relevance_score)}</Tag>
                  </button>
                  {graphEdgeIds.length > 0 || graphPath !== null ? (
                    <Collapse
                      size="small"
                      className="chat-source-chain"
                      items={[
                        {
                          key: 'graphPath',
                          label: t('chat.viewGraphPath'),
                          children: <SourceChainDetails citation={citation} graphPath={graphPath} />,
                        },
                      ]}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ),
    },
  ];

  return (
    <Collapse
      className="chat-citations"
      defaultActiveKey={['citations']}
      size="small"
      items={collapseItems}
    />
  );
}

function ChatMessageParts({ parts }: { parts: ChatMessagePart[] }) {
  if (parts.length === 0) {
    return null;
  }

  return (
    <div className="chat-message-parts">
      {parts.map((part, index) => {
        if (part.type === 'tool_use') {
          return <ToolUsePanel key={`${part.id ?? part.name}-${index}`} part={part} />;
        }

        return <ChatChart key={part.id} option={part.option} chartType={part.chart_type} />;
      })}
    </div>
  );
}

function ToolUsePanel({ part }: { part: ChatToolUsePart }) {
  const { t } = useTranslation();
  const command = formatToolInput(part.input);

  return (
    <Collapse
      className="chat-tool-use"
      size="small"
      items={[
        {
          key: 'toolUse',
          label: (
            <span>
              <span>{part.name}</span>{' '}
              <code>{command}</code>
            </span>
          ),
          children: <pre>{command}</pre>,
        },
      ]}
      aria-label={t('chat.toolUseLabel')}
    />
  );
}

function CompletionIndicator({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();

  if (message.role !== 'assistant' || message.status !== 'complete' || message.completedAt === null) {
    return null;
  }

  return (
    <div className="chat-completion-indicator" aria-label="Message complete">
      <span>{t('chat.completed')}</span>
      {message.latencyMs !== null ? <span>{formatLatency(message.latencyMs)}</span> : null}
    </div>
  );
}

function SourceChainDetails({ citation, graphPath }: { citation: ChatCitation; graphPath: GraphPathData | null }) {
  const { t } = useTranslation();
  const sourceDocumentIds = getCitationStringArray(citation, 'source_document_ids');
  const graphNodeIds = getCitationStringArray(citation, 'graph_node_ids');
  const graphEdgeIds = getCitationStringArray(citation, 'graph_edge_ids');
  const chainConfidence = getCitationNumber(citation, 'chain_confidence');

  return (
    <div className="chat-source-chain-body">
      <div className="chat-source-chain-grid">
        {sourceDocumentIds.length > 0 ? (
          <>
            <span>{t('chat.sourceDocIds')}</span>
            <code>{sourceDocumentIds.join(', ')}</code>
          </>
        ) : null}
        {graphNodeIds.length > 0 ? (
          <>
            <span>{t('chat.graphNodeIds')}</span>
            <code>{graphNodeIds.join(' -> ')}</code>
          </>
        ) : null}
        {graphEdgeIds.length > 0 ? (
          <>
            <span>{t('chat.graphEdgeIds')}</span>
            <code>{graphEdgeIds.join(' -> ')}</code>
          </>
        ) : null}
        {chainConfidence !== null ? (
          <>
            <span>{t('chat.chainConfidence')}</span>
            <code>{formatCitationScore(chainConfidence)}</code>
          </>
        ) : null}
      </div>
      <ConfidenceBadge label={getCitationConfidenceLabel(citation)} />
      {graphPath !== null ? <GraphPathViewer path={graphPath} /> : null}
    </div>
  );
}

function AgentThinkingIndicator() {
  const { t } = useTranslation();

  return (
    <div className="chat-agent-thinking" aria-label={t('chat.agentThinking')}>
      <span>{t('chat.agentThinking')}</span>
      <span className="chat-thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
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

function normalizeRetrievalMode(value: string): RetrievalMode {
  const validValues: RetrievalMode[] = ['wiki_only', 'graph_rag', 'path_first', 'community_first'];
  return validValues.includes(value as RetrievalMode) ? (value as RetrievalMode) : DEFAULT_RETRIEVAL_MODE;
}

function loadChatSettings(spaceId: string): ChatSettings {
  if (typeof window === 'undefined' || spaceId.length === 0) {
    return DEFAULT_CHAT_SETTINGS;
  }

  const raw = window.sessionStorage.getItem(getChatSettingsKey(spaceId));
  if (raw === null) {
    return DEFAULT_CHAT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return DEFAULT_CHAT_SETTINGS;
    }

    return {
      enableDeepAnalysis: parsed.enableDeepAnalysis === true,
      enableDatabase: parsed.enableDatabase === true,
      retrievalMode: typeof parsed.retrievalMode === 'string' ? normalizeRetrievalMode(parsed.retrievalMode) : DEFAULT_RETRIEVAL_MODE,
    };
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

function saveChatSettings(spaceId: string, settings: ChatSettings): void {
  if (typeof window === 'undefined' || spaceId.length === 0) {
    return;
  }

  window.sessionStorage.setItem(getChatSettingsKey(spaceId), JSON.stringify(settings));
}

function getChatSettingsKey(spaceId: string): string {
  return `cherry-chat-settings:${spaceId}`;
}

function isSpaceDatabaseEnabled(value: unknown): boolean {
  return isRecord(value) && value.enabled === true;
}

function formatToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  if (isRecord(input)) {
    const command = readStringValue(input, 'command') ?? readStringValue(input, 'query') ?? readStringValue(input, 'input');
    if (command !== null) {
      return command;
    }
  }

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function formatLatency(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    return '';
  }

  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
  }

  return `${Math.max(0, Math.round(milliseconds))}ms`;
}

function getCitationConfidenceLabel(citation: ChatCitation): string | null {
  const chain = getCitationSourceChain(citation);
  const directLabel = readStringValue(chain, 'edge_confidence') ?? readStringValue(chain, 'confidence_label');
  if (directLabel !== null) {
    return directLabel;
  }

  const graphPath = getCitationGraphPath(citation);
  return graphPath?.edges.find((edge) => edge.confidence_label !== null && edge.confidence_label !== undefined)?.confidence_label ?? null;
}

function getCitationStringArray(citation: ChatCitation, key: string): string[] {
  const chain = getCitationSourceChain(citation);
  const directValue = chain[key] ?? citation.source_chain_json[key];
  return readStringArray(directValue);
}

function getCitationNumber(citation: ChatCitation, key: string): number | null {
  const chain = getCitationSourceChain(citation);
  return readNumberValue(chain, key) ?? readNumberValue(citation.source_chain_json, key);
}

function getCitationSourceChain(citation: ChatCitation): Record<string, unknown> {
  return readRecordValue(citation.source_chain_json, 'source_chain') ?? citation.source_chain_json;
}

function getCitationGraphPath(citation: ChatCitation): GraphPathData | null {
  const sourceChain = getCitationSourceChain(citation);
  const pathRecord = readRecordValue(sourceChain, 'graph_path') ?? readRecordValue(citation.source_chain_json, 'graph_path');
  const nodesValue =
    readArrayValue(pathRecord, 'nodes') ??
    readArrayValue(sourceChain, 'graph_path_nodes') ??
    readArrayValue(citation.source_chain_json, 'graph_path_nodes');

  if (nodesValue === null || nodesValue.length === 0) {
    return null;
  }

  const nodes = nodesValue.map(normalizeGraphPathNode);
  const edgesValue =
    readArrayValue(pathRecord, 'edges') ??
    readArrayValue(sourceChain, 'graph_path_edges') ??
    readArrayValue(citation.source_chain_json, 'graph_path_edges') ??
    [];
  const edges = edgesValue.map((edge, index) => normalizeGraphPathEdge(edge, index, nodes));
  const confidence =
    readNumberValue(pathRecord, 'total_confidence') ??
    readNumberValue(pathRecord, 'confidence') ??
    readNumberValue(sourceChain, 'chain_confidence');
  const graphPath: GraphPathData = { nodes, edges };

  if (confidence !== null) {
    graphPath.total_confidence = confidence;
  }

  return graphPath;
}

function normalizeGraphPathNode(value: unknown, index: number): GraphPathNode {
  if (!isRecord(value)) {
    return { id: `node-${index}`, label: String(value) };
  }

  const id =
    readStringValue(value, 'id') ??
    readStringValue(value, 'node_id') ??
    readStringValue(value, 'node_key') ??
    readStringValue(value, 'stable_key') ??
    `node-${index}`;
  const node: GraphPathNode = { id };
  const label = readStringValue(value, 'label') ?? readStringValue(value, 'name');
  const nodeKey = readStringValue(value, 'node_key');
  const stableKey = readStringValue(value, 'stable_key');
  const nodeType = readStringValue(value, 'node_type') ?? readStringValue(value, 'type');

  if (label !== null) node.label = label;
  if (nodeKey !== null) node.node_key = nodeKey;
  if (stableKey !== null) node.stable_key = stableKey;
  if (nodeType !== null) node.node_type = nodeType;

  return node;
}

function normalizeGraphPathEdge(value: unknown, index: number, nodes: GraphPathNode[]): GraphPathEdge {
  const sourceFallback = nodes[index]?.id ?? `source-${index}`;
  const targetFallback = nodes[index + 1]?.id ?? `target-${index}`;

  if (!isRecord(value)) {
    return {
      id: `edge-${index}`,
      source_node_id: sourceFallback,
      target_node_id: targetFallback,
      relationship: String(value),
    };
  }

  const edge: GraphPathEdge = {
    id: readStringValue(value, 'id') ?? readStringValue(value, 'edge_id') ?? `edge-${index}`,
    source_node_id: readStringValue(value, 'source_node_id') ?? readStringValue(value, 'source') ?? sourceFallback,
    target_node_id: readStringValue(value, 'target_node_id') ?? readStringValue(value, 'target') ?? targetFallback,
  };
  const relationship = readStringValue(value, 'relationship') ?? readStringValue(value, 'relationship_type') ?? readStringValue(value, 'type');
  const confidenceLabel = readStringValue(value, 'confidence_label') ?? readStringValue(value, 'edge_confidence');
  const confidenceScore = readNumberValue(value, 'effective_confidence_score') ?? readNumberValue(value, 'confidence');

  if (relationship !== null) edge.relationship = relationship;
  if (confidenceLabel !== null) edge.confidence_label = confidenceLabel;
  if (confidenceScore !== null) edge.effective_confidence_score = confidenceScore;

  return edge;
}

function readRecordValue(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (record === null) {
    return null;
  }

  const value = record[key];
  return isRecord(value) ? value : null;
}

function readArrayValue(record: Record<string, unknown> | null, key: string): unknown[] | null {
  if (record === null) {
    return null;
  }

  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function readStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumberValue(record: Record<string, unknown> | null, key: string): number | null {
  if (record === null) {
    return null;
  }

  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (typeof citation.page_id === 'string' && citation.page_id.length > 0) return citation.page_id;
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
