import { FullscreenOutlined } from '@ant-design/icons';
import { Button, Empty, Spin, Tooltip } from 'antd';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphEdge, GraphNode } from '../../lib/graphApi';
import { useGraphTheme } from './useGraphTheme';

export type GraphLink = GraphEdge & {
  source: string;
  target: string;
};

export type GraphCanvasData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const NODE_TYPE_COLORS: Record<string, string> = {
  concept: '#89b4fa',
  entity: '#a6e3a1',
  document: '#f9e2af',
  topic: '#cba6f7',
  person: '#f38ba8',
  organization: '#89dceb',
  default: '#94a3b8',
};
const DEFAULT_NODE_COLOR = '#94a3b8';
const SELECTED_GRAPH_COLOR = '#fab387';

export function truncateNodeLabel(label: string, maxLength = 18): string {
  return label.length > maxLength ? `${label.slice(0, maxLength)}…` : label;
}

export function getNodeColor(
  nodeId: string | number | undefined,
  selectedNodeId: string | null,
  activeCommunityId: string | null,
  communityId: string | null | undefined,
  nodeType: string | null | undefined,
  primaryColor: string,
): string {
  if (nodeId !== undefined && selectedNodeId !== null && String(nodeId) === selectedNodeId) {
    return SELECTED_GRAPH_COLOR;
  }

  if (activeCommunityId !== null && communityId === activeCommunityId) {
    return primaryColor;
  }

  return NODE_TYPE_COLORS[nodeType ?? 'default'] ?? DEFAULT_NODE_COLOR;
}

export function getLinkColor(
  linkId: string | number | undefined,
  selectedEdgeId: string | null,
  textTertiaryColor: string,
): string {
  return linkId !== undefined && selectedEdgeId !== null && String(linkId) === selectedEdgeId
    ? SELECTED_GRAPH_COLOR
    : textTertiaryColor;
}

function withHexAlpha(color: string, alphaHex: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}${alphaHex}`;
  }

  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, red, green, blue] = color;
    return `#${red}${red}${green}${green}${blue}${blue}${alphaHex}`;
  }

  return color;
}

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
  const theme = useGraphTheme();
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

  // 数据就绪后自动 fit-to-view，确保初次加载/展开/社区切换时视口贴合内容
  useEffect(() => {
    if (graphData.nodes.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(400, 48);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [graphData.nodes.length, graphData.links.length]);

  const resolveNodeColor = (node: NodeObject<GraphNode>): string =>
    getNodeColor(node.id, selectedNodeId, activeCommunityId, node.community_id, node.node_type, theme.primary);

  const resolveLinkColor = (link: LinkObject<GraphNode, GraphLink>): string =>
    getLinkColor(link.id, selectedEdgeId, theme.textTertiary);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: size.height,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--color-background-mute)',
      }}
    >
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
          backgroundColor={theme.canvasBg}
          nodeColor={resolveNodeColor}
          nodeLabel={(node) => escapeHtml(node.label)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const label = node.label ?? '';
            const displayLabel = truncateNodeLabel(label);
            const size = 5;
            const color = resolveNodeColor(node);
            const isSelected = node.id !== undefined && selectedNodeId !== null && String(node.id) === selectedNodeId;

            ctx.shadowBlur = isSelected ? 12 : graphData.nodes.length > 300 ? 0 : 4;
            ctx.shadowColor = isSelected ? SELECTED_GRAPH_COLOR : graphData.nodes.length > 300 ? 'transparent' : withHexAlpha(color, '66');
            ctx.beginPath();
            ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI, false);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';

            if (isSelected) {
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, size + 1, 0, 2 * Math.PI, false);
              ctx.strokeStyle = theme.background;
              ctx.lineWidth = 2;
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(node.x!, node.y!, size + 4, 0, 2 * Math.PI, false);
              ctx.strokeStyle = SELECTED_GRAPH_COLOR;
              ctx.lineWidth = 3;
              ctx.stroke();
            }

            if (globalScale >= 0.5) {
              const fontSize = 12 / globalScale;
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = theme.textPrimary;
              ctx.fillText(displayLabel, node.x!, node.y! + size + 2);
            }
          }}
          nodeCanvasObjectMode={() => 'replace'}
          nodeRelSize={6}
          linkColor={resolveLinkColor}
          linkLabel={(link) => escapeHtml(link.relationship)}
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          linkWidth={(link) => (link.id === selectedEdgeId ? 3.5 : 1.8)}
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
