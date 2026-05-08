import { Card } from 'antd';
import { useTranslation } from 'react-i18next';
import { ConfidenceBadge, getConfidenceTone } from './ConfidenceBadge.js';

export type GraphPathNode = {
  id: string;
  label?: string | null;
  node_key?: string | null;
  stable_key?: string | null;
  node_type?: string | null;
};

export type GraphPathEdge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship?: string | null;
  confidence_label?: string | null;
  effective_confidence_score?: number | null;
  confidence?: number | null;
};

export type GraphPathData = {
  nodes: GraphPathNode[];
  edges: GraphPathEdge[];
  confidence?: number | null;
  total_confidence?: number | null;
};

type GraphPathViewerProps = {
  path: GraphPathData;
};

export default function GraphPathViewer({ path }: GraphPathViewerProps) {
  const { t } = useTranslation();
  const pathConfidence = path.total_confidence ?? path.confidence ?? null;
  const confidenceTone = getConfidenceTone(pathConfidence);

  if (path.nodes.length === 0) {
    return <div className="graph-path-empty">{t('chat.noGraphPath')}</div>;
  }

  return (
    <Card
      size="small"
      className={`graph-path-viewer confidence-${confidenceTone}`}
      aria-label="Graph path"
    >
      <div className="graph-path-meta">
        <strong>{t('chat.viewGraphPath')}</strong>
        {pathConfidence !== null ? <span>{formatConfidence(pathConfidence)}</span> : null}
      </div>
      <div className="graph-path-track">
        {path.nodes.map((node, index) => {
          const edge = path.edges[index];
          return (
            <div className="graph-path-step" key={`${node.id}-${index}`}>
              <div className="graph-path-node">
                <strong>{getNodeLabel(node)}</strong>
                {node.node_type !== null && node.node_type !== undefined ? <span>{node.node_type}</span> : null}
              </div>
              {edge !== undefined ? (
                <div className={`graph-path-edge confidence-${getConfidenceTone(getEdgeScore(edge))}`}>
                  <span className="graph-path-edge-line" aria-hidden="true" />
                  <span className="graph-path-edge-label">
                    {edge.relationship ?? t('chat.relatedEdge')}
                    <ConfidenceBadge label={edge.confidence_label} />
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function getNodeLabel(node: GraphPathNode): string {
  return node.label ?? node.node_key ?? node.stable_key ?? node.id;
}

function getEdgeScore(edge: GraphPathEdge): number | null {
  return edge.effective_confidence_score ?? edge.confidence ?? null;
}

function formatConfidence(value: number): string {
  if (value >= 0 && value <= 1) {
    return `${Math.round(value * 100)}%`;
  }

  return value.toFixed(2);
}
