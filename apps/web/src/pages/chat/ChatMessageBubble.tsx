import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../hooks/useChatStream.js';
import { AssistantMarkdown } from './AssistantMarkdown.js';
import { ChatMessageParts } from './ChatMessageParts.js';
import { CitationPanel } from './CitationPanel.js';
import { formatLatency } from './sourceChainUtils.js';

type ChatMessageBubbleProps = {
  message: ChatMessage;
  spaceId: string;
  spaceNameById?: Record<string, string>;
};

export function ChatMessageBubble({ message, spaceId, spaceNameById = {} }: ChatMessageBubbleProps) {
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
            <CitationPanel citations={message.citations} spaceId={spaceId} spaceNameById={spaceNameById} />
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
