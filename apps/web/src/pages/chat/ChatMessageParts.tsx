import { Collapse } from 'antd';
import { useTranslation } from 'react-i18next';
import ChatChart from '../../components/ChatChart.js';
import type { ChatMessagePart, ChatToolUsePart } from '../../hooks/useChatStream.js';
import { formatToolInput } from './sourceChainUtils.js';

type ChatMessagePartsProps = {
  parts: ChatMessagePart[];
};

export function ChatMessageParts({ parts }: ChatMessagePartsProps) {
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
