import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { ConfidenceBadge } from '../../components/ConfidenceBadge.js';
import type { ChatCitation } from '../../hooks/useChatStream.js';
import { buildCitationPath, getCitationConfidenceLabel, transformMarkdownUrl } from './sourceChainUtils.js';

type AssistantMarkdownProps = {
  content: string;
  citations: ChatCitation[];
  spaceId: string;
};

export function AssistantMarkdown({ content, citations, spaceId }: AssistantMarkdownProps) {
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
