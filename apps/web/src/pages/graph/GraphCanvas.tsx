import { FullscreenOutlined } from '@ant-design/icons';
import { Button, Empty, Spin, Tooltip } from 'antd';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphEdge, GraphNode } from '../../lib/graphApi';

export type GraphLink = GraphEdge & {
  source: string;
  target: string;
};

export type GraphCanvasData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const NODE_TYPE_COLORS: Record<string, string> = {
  concept: '#2563eb',
  entity: '#059669',
  document: '#d97706',
  topic: '#7c3aed',
  person: '#dc2626',
  organization: '#0891b2',
  default: '#64748b',
};
const DEFAULT_NODE_COLOR = '#64748b';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return char;
    }
  });
}

type GraphCanvasProps = {
  graphData: GraphCanvasData;
  activeCommunityId: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  loading: boolean;
  onNodeSelect: (nodeId: string) => void;
  onEdgeSelect: (edgeId: string) => void;
};

export default function GraphCanvas({
  graphData,
  activeCommunityId,
  selectedNodeId,
  selectedEdgeId,
  loading,
  onNodeSelect,
  onEdgeSelect,
}: GraphCanvasProps) {
  const { t } = useTranslation();
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined);
  const [size, setSize] = useState({ width: 720, height: 520 });

  useEffect(() => {
    const updateSize = () => {
      const width = Math.max(360, Math.min(window.innerWidth - 520, 1120));
      const height = Math.max(420, window.innerHeight - 260);
      setSize({ width, height });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const data = useMemo(
    () => ({
      nodes: graphData.nodes.map((node) => ({ ...node })),
      links: graphData.links.map((link) => ({ ...link })),
    }),
    [graphData.links, graphData.nodes],
  );

  function resetView(): void {
    graphRef.current?.zoomToFit(400, 48);
  }

  function getNodeColor(node: NodeObject<GraphNode>): string {
    if (node.id === selectedNodeId) {
      return '#f97316';
    }

    if (activeCommunityId !== null && node.community_id === activeCommunityId) {
      return '#16a34a';
    }

    return NODE_TYPE_COLORS[node.node_type ?? 'default'] ?? DEFAULT_NODE_COLOR;
  }

  function getLinkColor(link: LinkObject<GraphNode, GraphLink>): string {
    return link.id === selectedEdgeId ? '#f97316' : 'rgba(71, 85, 105, 0.62)';
  }

  return (
    <div style={{ position: 'relative', minHeight: size.height, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#ffffff' }}>
      <div style={{ position: 'absolute', right: 12, top: 12, zIndex: 2 }}>
        <Tooltip title={t('graph.canvas.resetView')}>
          <Button aria-label={t('graph.canvas.resetView')} icon={<FullscreenOutlined />} onClick={resetView} />
        </Tooltip>
      </div>
      {graphData.nodes.length === 0 ? (
        <div style={{ display: 'grid', placeItems: 'center', minHeight: size.height }}>
          {loading ? <Spin tip={t('graph.state.loading')} /> : <Empty description={t('graph.state.empty')} />}
        </div>
      ) : (
        <ForceGraph2D
          ref={graphRef}
          graphData={data}
          nodeId="id"
          linkSource="source"
          linkTarget="target"
          width={size.width}
          height={size.height}
          backgroundColor="#ffffff"
          nodeColor={getNodeColor}
          nodeLabel={(node) => escapeHtml(node.label)}
          nodeRelSize={6}
          linkColor={getLinkColor}
          linkLabel={(link) => escapeHtml(link.relationship)}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkWidth={(link) => (link.id === selectedEdgeId ? 2.5 : 1.2)}
          onNodeClick={(node) => {
            if (typeof node.id === 'string') {
              onNodeSelect(node.id);
            }
          }}
          onLinkClick={(link) => {
            if (typeof link.id === 'string') {
              onEdgeSelect(link.id);
            }
          }}
        />
      )}
    </div>
  );
}

export function getGraphNodeTypeColor(nodeType: string | null): string {
  return NODE_TYPE_COLORS[nodeType ?? 'default'] ?? DEFAULT_NODE_COLOR;
}

export const GRAPH_NODE_TYPE_COLORS = NODE_TYPE_COLORS;
