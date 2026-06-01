import { Collapse, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ConfidenceBadge } from '../../components/ConfidenceBadge.js';
import GraphPathViewer, { type GraphPathData } from '../../components/GraphPathViewer.js';
import type { ChatCitation } from '../../hooks/useChatStream.js';
import {
  buildCitationPath,
  formatCitationScore,
  getCitationConfidenceLabel,
  getCitationGraphPath,
  getCitationNumber,
  getCitationStringArray,
} from './sourceChainUtils.js';

type CitationPanelProps = {
  citations: ChatCitation[];
  spaceId: string;
  spaceNameById: Record<string, string>;
};

export function CitationPanel({ citations, spaceId, spaceNameById }: CitationPanelProps) {
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
            const citationSpaceId = citation.space_id ?? spaceId;
            const citationSpaceName = spaceNameById[citationSpaceId] ?? citationSpaceId;
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
                    {citationSpaceId !== spaceId ? <Tag color="geekblue">{t('chat.sourceSpace', { name: citationSpaceName })}</Tag> : null}
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
