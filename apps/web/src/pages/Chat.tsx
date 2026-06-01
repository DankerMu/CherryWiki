import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { Alert, Button, Empty, Input, List, message, Popconfirm, Select, Spin, Tag } from 'antd';
import {
  CloseOutlined,
  DeleteOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { formatDate } from '../components/adminUi.js';
import { SpaceForbiddenState, useSpacePermissionGate } from '../components/SpacePermissionGate.js';
import {
  CHAT_INPUT_MAX_LENGTH,
  getChatErrorMessage,
  isAgentRetrievalMode,
  useChatStream,
  type RetrievalMode,
  type SendMessageOptions,
} from '../hooks/useChatStream.js';
import { useAuth } from '../lib/auth.js';
import NotFound from './NotFound.js';
import {
  CHAT_SPACE_SELECTION_MAX,
  DEFAULT_CHAT_SETTINGS,
  normalizeRetrievalMode,
  normalizeSelectedSpaceIds,
} from './chat/chatScopeUtils.js';
import { ChatMessageBubble } from './chat/ChatMessageBubble.js';
import type { AvailableChatSpace, ChatSession, ChatSettings } from './chat/types.js';
import { useChatDatabaseGate } from './chat/useChatDatabaseGate.js';
import { useChatModelGate } from './chat/useChatModelGate.js';
import { useChatScopeSettings } from './chat/useChatScopeSettings.js';
import { useChatSessions } from './chat/useChatSessions.js';

export { ChatMessageBubble } from './chat/ChatMessageBubble.js';

type MessageInputProps = {
  disabled: boolean;
  isStreaming: boolean;
  onSend: (message: string, options: ChatSettings) => Promise<void> | void;
  settings?: ChatSettings;
  databaseAvailable?: boolean;
  onSettingsChange?: (settings: ChatSettings) => void;
};

type SpaceSelectorProps = {
  availableSpaces: AvailableChatSpace[];
  selectedSpaceIds: string[];
  primarySpaceId: string;
  locked: boolean;
  onChange: (spaceIds: string[]) => Promise<void> | void;
  onStartNewSession: () => void;
};

type SessionSidebarProps = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (session: ChatSession) => void;
};

const CHAT_SIDEBAR_COLLAPSED_KEY = 'cherry-chat-sidebar-collapsed';

export default function Chat() {
  const { t } = useTranslation();
  const { spaceId = '' } = useParams();
  const { accessToken, hasSpacePermission, isAdmin, isAuthenticated, user } = useAuth();
  const gate = useSpacePermissionGate(['space:view', 'chat:use']);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const previousSpaceIdRef = useRef(spaceId);
  const loadSessionsRef = useRef<((background?: boolean) => Promise<void>) | undefined>(undefined);
  const {
    availableSpaces,
    chatSettings,
    selectedSpaceIds,
    setAvailableSpaces,
    setSelectedSpaceIds,
    refreshAvailableSpaces,
    updateChatSettings,
  } = useChatScopeSettings({
    spaceId,
    isAuthenticated,
    isAllowed: gate.isAllowed,
    user,
    hasSpacePermission,
  });
  const chatModelAvailable = useChatModelGate(isAuthenticated && gate.isAllowed);
  const { databaseAvailable } = useChatDatabaseGate({
    spaceId,
    isAuthenticated,
    isAllowed: gate.isAllowed,
    selectedSpaceIds,
    chatSettings,
    updateChatSettings,
  });
  const spaceNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const space of availableSpaces) {
      names[space.id] = space.name;
    }
    return names;
  }, [availableSpaces]);

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
      void loadSessionsRef.current?.(true);
    },
  });

  const {
    sessions,
    sessionsLoading,
    sessionsError,
    loadSessions,
    openSession,
    executeDeleteSession,
    newChat,
    handleSpaceChange,
  } = useChatSessions({
    spaceId,
    isAuthenticated,
    isAllowed: gate.isAllowed,
    activeSessionId: sessionId,
    selectedSpaceIds,
    setSelectedSpaceIds,
    setAvailableSpaces,
    loadStreamSession: loadSession,
    startStreamNewSession: startNewSession,
    closeMobileSidebar: () => setIsMobileSidebarOpen(false),
    scopeUpdateFailedMessage: t('chat.scopeUpdateFailed'),
  });

  loadSessionsRef.current = loadSessions;

  useEffect(() => {
    if (previousSpaceIdRef.current !== spaceId) {
      startNewSession();
      previousSpaceIdRef.current = spaceId;
    }
  }, [spaceId, startNewSession]);

  useEffect(() => {
    if (streamError?.status === 403 || streamError?.code === 'SPACE_PERMISSION_DENIED') {
      refreshAvailableSpaces();
    }
  }, [refreshAvailableSpaces, streamError]);

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  useEffect(() => {
    saveSidebarCollapsed(isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (spaceId.length === 0) {
    return <NotFound />;
  }

  if (!gate.isAllowed) {
    return <SpaceForbiddenState context="chat" />;
  }

  async function handleSend(message: string, settings: ChatSettings): Promise<void> {
    const options: SendMessageOptions = {
      sessionId,
      spaceIds: selectedSpaceIds,
      enableDeepAnalysis: settings.enableDeepAnalysis,
      enableDatabase: databaseAvailable && settings.enableDatabase,
      retrievalMode: settings.retrievalMode,
    };

    await sendMessage(message, options);
    await loadSessions(true);
  }

  const chatErrorMessage = getChatErrorMessage(streamError, selectedSpaceIds.length);
  const selectorLocked = isStreaming;
  const chatInputDisabled = isStreaming || chatModelAvailable.loading || !chatModelAvailable.available;

  return (
    <div className={`chat-page${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      {isMobileSidebarOpen ? (
        <button
          className="chat-sidebar-backdrop"
          type="button"
          aria-label={t('chat.closeSessions')}
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={`chat-session-sidebar${isMobileSidebarOpen ? ' open' : ''}`}
        aria-label={t('chat.title')}
        aria-hidden={isSidebarCollapsed && !isMobileSidebarOpen}
        inert={isSidebarCollapsed && !isMobileSidebarOpen ? true : undefined}
      >
        <div className="chat-sidebar-header">
          <div>
            <span className="eyebrow">{t('chat.space')}</span>
            <strong>{t('chat.brand')}</strong>
          </div>
          <div className="chat-sidebar-actions">
            <Button
              type="text"
              icon={<MenuFoldOutlined />}
              className="chat-sidebar-collapse"
              onClick={() => setIsSidebarCollapsed(true)}
              aria-label={t('chat.collapseSidebar')}
            />
            <Button
              type="text"
              icon={<CloseOutlined />}
              className="chat-sidebar-close"
              onClick={() => setIsMobileSidebarOpen(false)}
              aria-label={t('chat.closeSidebar')}
            />
          </div>
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

      {isSidebarCollapsed ? (
        <button
          className="chat-sidebar-expand"
          type="button"
          aria-label={t('chat.expandSidebar')}
          onClick={() => setIsSidebarCollapsed(false)}
        >
          <MenuUnfoldOutlined />
        </button>
      ) : null}

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
            <Empty description={selectedSpaceIds.length > 1 ? t('chat.emptyMultiSpaceConversation') : t('chat.emptyConversation')} />
          ) : (
            messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} spaceId={spaceId} spaceNameById={spaceNameById} />
            ))
          )}
          <div ref={messagesEndRef} />
        </section>

        <div className="chat-bottom-area">
          {!chatModelAvailable.loading && !chatModelAvailable.available ? (
            <Alert
              type="warning"
              showIcon
              message={
                isAdmin ? (
                  <span>
                    {t('chat.noModelAdminPrefix')}
                    <Link to="/admin/models">{t('chat.noModelAdminLink')}</Link>
                    {t('chat.noModelAdminSuffix')}
                  </span>
                ) : (
                  t('chat.noModelUser')
                )
              }
            />
          ) : null}

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

          <SpaceSelector
            availableSpaces={availableSpaces}
            selectedSpaceIds={selectedSpaceIds}
            primarySpaceId={spaceId}
            locked={selectorLocked}
            onChange={handleSpaceChange}
            onStartNewSession={newChat}
          />
          <MessageInput
            disabled={chatInputDisabled}
            isStreaming={isStreaming}
            settings={chatSettings}
            databaseAvailable={databaseAvailable}
            onSettingsChange={updateChatSettings}
            onSend={handleSend}
          />
        </div>
      </main>
    </div>
  );
}

export function SpaceSelector({
  availableSpaces,
  selectedSpaceIds,
  primarySpaceId,
  locked,
  onChange,
  onStartNewSession,
}: SpaceSelectorProps) {
  const { t } = useTranslation();
  const spaceNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const space of availableSpaces) {
      names[space.id] = space.name;
    }
    return names;
  }, [availableSpaces]);

  const selectedIds = normalizeSelectedSpaceIds(primarySpaceId, selectedSpaceIds);
  const isAtSpaceLimit = selectedIds.length >= CHAT_SPACE_SELECTION_MAX;
  const options = availableSpaces.map((space) => ({
    value: space.id,
    label: space.name,
    disabled: space.id === primarySpaceId || (isAtSpaceLimit && !selectedIds.includes(space.id)),
  }));

  return (
    <section className="chat-space-selector-panel" aria-label={t('chat.spaceSelectorLabel')}>
      <div className="chat-space-selector-header">
        <label htmlFor="chat-space-selector">{t('chat.spaceSelectorLabel')}</label>
        {locked ? (
          <span className="chat-scope-lock">
            <LockOutlined />
            {t('chat.scopeLocked')}
          </span>
        ) : null}
      </div>
      <div className="chat-space-selector-row">
        <Select
          id="chat-space-selector"
          aria-label={t('chat.spaceSelectorLabel')}
          mode="multiple"
          disabled={locked}
          value={selectedIds}
          options={options}
          placeholder={t('chat.spaceSelectorPlaceholder')}
          className="chat-space-selector"
          popupMatchSelectWidth={false}
          optionFilterProp="label"
          tagRender={({ label, value, closable, onClose }) => {
            const isPrimary = value === primarySpaceId;
            return (
              <Tag
                closable={!locked && !isPrimary && closable}
                onClose={onClose}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                {...(isPrimary ? { color: 'blue' } : {})}
              >
                {isPrimary ? t('chat.primarySpaceTag', { name: label }) : label}
              </Tag>
            );
          }}
          onChange={(nextIds) => {
            const normalizedIds = normalizeSelectedSpaceIds(primarySpaceId, nextIds);
            if (normalizedIds.length > CHAT_SPACE_SELECTION_MAX) {
              void message.warning(t('chat.spaceSelectorMax'));
              return;
            }
            void onChange(normalizedIds);
          }}
        />
        {locked ? (
          <Button size="small" icon={<PlusOutlined />} onClick={onStartNewSession}>
            {t('chat.changeScopeNewChat')}
          </Button>
        ) : null}
      </div>
      {selectedIds.length > 1 ? (
        <p className="chat-space-selector-help">
          {t('chat.multiSpaceSelected', {
            count: selectedIds.length,
            names: selectedIds.map((id) => spaceNameById[id] ?? id).join('、'),
          })}
        </p>
      ) : null}
    </section>
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
      <Input.TextArea
        id="chat-message-input"
        value={value}
        maxLength={CHAT_INPUT_MAX_LENGTH}
        rows={3}
        disabled={disabled}
        placeholder={isStreaming ? t('chat.streamingPlaceholder') : t('chat.inputPlaceholder')}
        onChange={(event) => setValue(event.target.value.slice(0, CHAT_INPUT_MAX_LENGTH))}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key === 'Process' || event.nativeEvent.keyCode === 229) {
            return;
          }

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
            <Button
              key={opt.value}
              size="small"
              type={isActive ? 'primary' : 'default'}
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
            </Button>
          );
        })}
        <label className="chat-retrieval-mode-label" htmlFor="chat-retrieval-mode">
          {t('chat.retrievalModeLabel')}
          <Select
            id="chat-retrieval-mode"
            size="small"
            virtual={false}
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
            const spaceCount = session.space_ids?.length ?? 1;
            return (
              <List.Item
                className={`chat-session-item${session.id === activeSessionId ? ' active' : ''}`}
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest('.chat-session-delete-button') !== null) {
                    return;
                  }
                  onSelectSession(session.id);
                }}
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
                      className="chat-session-delete-button"
                      icon={<DeleteOutlined />}
                      aria-label={`${t('common.action.delete')} ${title}`}
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span className="chat-session-title">
                      <span>{title}</span>
                      {spaceCount > 1 ? <Tag color="purple">{t('chat.multiSpaceBadge', { count: spaceCount })}</Tag> : null}
                    </span>
                  }
                  description={formatSessionDescription(session)}
                />
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(isCollapsed: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
  } catch {
    // localStorage can be unavailable in private browsing contexts.
  }
}

function formatSessionDescription(session: ChatSession): string {
  const updatedAt = formatDate(session.updated_at);
  const names = session.space_details?.map((space) => space.name).filter((name) => name.length > 0) ?? [];
  return names.length > 1 ? `${updatedAt} · ${names.join('、')}` : updatedAt;
}

function getSessionTitle(session: ChatSession): string {
  if (session.title !== null && session.title.trim().length > 0) {
    return session.title;
  }

  return `Chat ${session.id.slice(0, 8)}`;
}
