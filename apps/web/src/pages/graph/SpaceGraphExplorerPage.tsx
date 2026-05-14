import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { getErrorMessage } from '../../components/adminUi';
import { SpaceForbiddenState, useSpacePermissionGate } from '../../components/SpacePermissionGate';
import { api } from '../../lib/api';
import type { AdminSpaceDetail } from '../../lib/adminTypes';
import {
  getGraphCommunities,
  getGraphNeighbors,
  searchGraphNodes,
  type GraphCommunity,
  type GraphEdge,
  type GraphNode,
} from '../../lib/graphApi';
import NotFound from '../NotFound';
import GraphCanvas, { GRAPH_NODE_TYPE_COLORS, getGraphNodeTypeColor, type GraphCanvasData } from './GraphCanvas';

const SEARCH_LIMIT = 20;
const MAX_GRAPH_NODES = 500;
const MAX_GRAPH_EDGES = 1000;

type GraphState = {
  nodesById: Map<string, GraphNode>;
  edgesById: Map<string, GraphEdge>;
  expandedNodeIds: Set<string>;
  truncated: boolean;
  edgeTruncated: boolean;
};

type GraphAction =
  | { type: 'clear' }
  | { type: 'merge'; spaceId: string; nodes: GraphNode[]; edges: GraphEdge[] }
  | { type: 'markExpanded'; nodeId: string };

const INITIAL_GRAPH_STATE: GraphState = {
  nodesById: new Map(),
  edgesById: new Map(),
  expandedNodeIds: new Set(),
  truncated: false,
  edgeTruncated: false,
};

type SpaceStatsResponse = {
  node_count: number;
};

type Selection =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;

export default function SpaceGraphExplorerPage() {
  const { t } = useTranslation();
  const { spaceId = '' } = useParams();
  const gate = useSpacePermissionGate('space:view');
  const [graphState, dispatch] = useReducer(graphReducer, INITIAL_GRAPH_STATE);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GraphNode[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [hops, setHops] = useState(1);
  const [communities, setCommunities] = useState<GraphCommunity[]>([]);
  const [isLoadingCommunities, setIsLoadingCommunities] = useState(true);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasEmptyGraph, setHasEmptyGraph] = useState(false);
  const searchSeqRef = useRef(0);
  const spaceSeqRef = useRef(0);

  useEffect(() => {
    const spaceSeq = ++spaceSeqRef.current;
    searchSeqRef.current++;
    dispatch({ type: 'clear' });
    setQuery('');
    setSearchResults([]);
    setHasSearched(false);
    setIsSearching(false);
    setIsExpanding(false);
    setActiveCommunityId(null);
    setSelection(null);
    setError(null);
    setHasEmptyGraph(false);

    if (spaceId.length === 0 || !gate.isAllowed) {
      setIsLoadingCommunities(false);
      return;
    }

    void (async () => {
      try {
        const [, stats] = await Promise.all([
          api.get<AdminSpaceDetail>(`/spaces/${encodeURIComponent(spaceId)}`),
          api.get<SpaceStatsResponse>(`/spaces/${encodeURIComponent(spaceId)}/stats`),
        ]);
        if (spaceSeq !== spaceSeqRef.current) {
          return;
        }
        setHasEmptyGraph(stats.node_count === 0);
      } catch (err) {
        if (spaceSeq !== spaceSeqRef.current) {
          return;
        }
        setError(getErrorMessage(err));
        setHasEmptyGraph(false);
      }
    })();
  }, [gate.isAllowed, spaceId]);

  const loadCommunities = useCallback(async () => {
    const spaceSeq = spaceSeqRef.current;
    if (spaceId.length === 0 || !gate.isAllowed) {
      setCommunities([]);
      setIsLoadingCommunities(false);
      return;
    }

    setIsLoadingCommunities(true);
    try {
      const response = await getGraphCommunities(spaceId);
      if (spaceSeq !== spaceSeqRef.current) {
        return;
      }
      setCommunities(response.communities);
    } catch (err) {
      if (spaceSeq !== spaceSeqRef.current) {
        return;
      }
      setError(getErrorMessage(err));
      setCommunities([]);
    } finally {
      if (spaceSeq === spaceSeqRef.current) {
        setIsLoadingCommunities(false);
      }
    }
  }, [gate.isAllowed, spaceId]);

  useEffect(() => {
    void loadCommunities();
  }, [loadCommunities]);

  const graphData = useMemo<GraphCanvasData>(() => {
    const nodes = [...graphState.nodesById.values()];
    const links = [...graphState.edgesById.values()].map((edge) => ({
      ...edge,
      source: edge.source_node_id,
      target: edge.target_node_id,
    }));
    return { nodes, links };
  }, [graphState.edgesById, graphState.nodesById]);

  const selectedNode = selection?.type === 'node' ? graphState.nodesById.get(selection.id) ?? null : null;
  const selectedEdge = selection?.type === 'edge' ? graphState.edgesById.get(selection.id) ?? null : null;

  if (spaceId.length === 0) {
    return <NotFound />;
  }

  if (!gate.isAllowed) {
    return <SpaceForbiddenState />;
  }

  async function handleSearch(nextQuery: string): Promise<void> {
    const normalizedQuery = nextQuery.trim();
    const seq = ++searchSeqRef.current;
    const spaceSeq = spaceSeqRef.current;
    setQuery(normalizedQuery);
    setHasSearched(true);
    setSearchResults([]);

    if (normalizedQuery.length === 0 || !gate.isAllowed) {
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await searchGraphNodes({ spaceId, query: normalizedQuery, limit: SEARCH_LIMIT });
      if (seq !== searchSeqRef.current || spaceSeq !== spaceSeqRef.current) {
        return;
      }

      const scopedNodes = response.nodes.filter((node) => node.space_id === spaceId);
      setSearchResults(scopedNodes);
      dispatch({ type: 'merge', spaceId, nodes: scopedNodes, edges: [] });
    } catch (err) {
      if (seq !== searchSeqRef.current || spaceSeq !== spaceSeqRef.current) {
        return;
      }
      setError(getErrorMessage(err));
    } finally {
      if (seq === searchSeqRef.current && spaceSeq === spaceSeqRef.current) {
        setIsSearching(false);
      }
    }
  }

  async function expandNode(nodeId: string, force = false): Promise<void> {
    if ((!force && graphState.expandedNodeIds.has(nodeId)) || !gate.isAllowed) {
      return;
    }

    const spaceSeq = spaceSeqRef.current;
    setIsExpanding(true);
    setError(null);

    try {
      const response = await getGraphNeighbors({ nodeId, spaceId, hops });
      if (spaceSeq !== spaceSeqRef.current) {
        return;
      }
      const nodes = [
        ...(response.center_node === null ? [] : [response.center_node]),
        ...response.neighbors.map((neighbor) => neighbor.node),
      ];
      const edges = response.neighbors
        .map((neighbor) => neighbor.edge)
        .filter((edge): edge is GraphEdge => edge !== null);
      dispatch({ type: 'merge', spaceId, nodes, edges });
      dispatch({ type: 'markExpanded', nodeId });
    } catch (err) {
      if (spaceSeq !== spaceSeqRef.current) {
        return;
      }
      setError(getErrorMessage(err));
    } finally {
      if (spaceSeq === spaceSeqRef.current) {
        setIsExpanding(false);
      }
    }
  }

  function closeSelection(): void {
    setSelection(null);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('graph.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('graph.description')}</Typography.Text>
        </div>
        <Button onClick={() => dispatch({ type: 'clear' })}>{t('graph.action.clearGraph')}</Button>
      </div>

      {error !== null ? (
        <Alert message={error} type="error" showIcon closable style={{ marginBottom: 16 }} onClose={() => setError(null)} />
      ) : null}
      {graphState.truncated ? (
        <Alert message={t('graph.state.truncated', { limit: MAX_GRAPH_NODES })} type="warning" showIcon style={{ marginBottom: 16 }} />
      ) : null}
      {graphState.edgeTruncated ? (
        <Alert message={t('graph.state.edgeTruncated', { limit: MAX_GRAPH_EDGES })} type="warning" showIcon style={{ marginBottom: 16 }} />
      ) : null}

      {hasEmptyGraph ? (
        <Empty
          description={(
            <Space direction="vertical" size={12}>
              <Typography.Text strong>{t('graph.emptyGraph.title')}</Typography.Text>
              <Typography.Text type="secondary">{t('graph.emptyGraph.description')}</Typography.Text>
              <Button type="primary" href={`/spaces/${encodeURIComponent(spaceId)}/graphify`}>
                {t('graph.emptyGraph.action')}
              </Button>
            </Space>
          )}
          style={{ marginTop: 48 }}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <GraphSearchPanel
              query={query}
              results={searchResults}
              hasSearched={hasSearched}
              isSearching={isSearching}
              onQueryChange={setQuery}
              onSearch={(value) => { void handleSearch(value); }}
              onSelectNode={(nodeId) => setSelection({ type: 'node', id: nodeId })}
            />
            <GraphCommunityPanel
              communities={communities}
              isLoading={isLoadingCommunities}
              activeCommunityId={activeCommunityId}
              onSelectCommunity={setActiveCommunityId}
            />
          </Space>

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <GraphToolbar
              hops={hops}
              isExpanding={isExpanding}
              selectedNode={selectedNode}
              alreadyExpanded={selectedNode !== null && graphState.expandedNodeIds.has(selectedNode.id)}
              onHopsChange={setHops}
              onExpand={(force) => {
                if (selectedNode !== null) {
                  void expandNode(selectedNode.id, force);
                }
              }}
            />
            <GraphCanvas
              graphData={graphData}
              activeCommunityId={activeCommunityId}
              selectedNodeId={selectedNode?.id ?? null}
              selectedEdgeId={selectedEdge?.id ?? null}
              loading={isSearching || isExpanding}
              onNodeSelect={(nodeId) => setSelection({ type: 'node', id: nodeId })}
              onEdgeSelect={(edgeId) => setSelection({ type: 'edge', id: edgeId })}
            />
            <GraphLegend />
          </Space>
        </div>
      )}

      <GraphSelectionDrawer
        selectedNode={selectedNode}
        selectedEdge={selectedEdge}
        nodeById={graphState.nodesById}
        onClose={closeSelection}
      />
    </div>
  );
}

function GraphSearchPanel({
  query,
  results,
  hasSearched,
  isSearching,
  onQueryChange,
  onSearch,
  onSelectNode,
}: {
  query: string;
  results: GraphNode[];
  hasSearched: boolean;
  isSearching: boolean;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div style={panelStyle}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>{t('graph.search.title')}</Typography.Title>
      <Input.Search
        allowClear
        enterButton={t('common.action.search')}
        loading={isSearching}
        onChange={(event) => onQueryChange(event.target.value)}
        onSearch={onSearch}
        placeholder={t('graph.search.placeholder')}
        value={query}
      />
      {isSearching ? <Spin style={{ marginTop: 16 }} /> : null}
      {!isSearching && hasSearched && results.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('graph.state.noResults')} style={{ marginTop: 16 }} />
      ) : null}
      {results.length > 0 ? (
        <List
          style={{ marginTop: 12 }}
          size="small"
          dataSource={results}
          renderItem={(node) => (
            <List.Item>
              <Button type="link" style={{ padding: 0, height: 'auto', textAlign: 'left' }} onClick={() => onSelectNode(node.id)}>
                {node.label}
              </Button>
              <Tag color={getGraphNodeTypeColor(node.node_type)}>{node.node_type ?? t('graph.nodeType.unknown')}</Tag>
            </List.Item>
          )}
        />
      ) : null}
    </div>
  );
}

function GraphCommunityPanel({
  communities,
  isLoading,
  activeCommunityId,
  onSelectCommunity,
}: {
  communities: GraphCommunity[];
  isLoading: boolean;
  activeCommunityId: string | null;
  onSelectCommunity: (communityId: string | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>{t('graph.community.title')}</Typography.Title>
        {activeCommunityId !== null ? (
          <Button size="small" onClick={() => onSelectCommunity(null)}>{t('graph.community.clear')}</Button>
        ) : null}
      </div>
      {isLoading ? <Spin style={{ marginTop: 16 }} /> : null}
      {!isLoading && communities.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('graph.community.empty')} style={{ marginTop: 16 }} />
      ) : null}
      {communities.length > 0 ? (
        <List
          style={{ marginTop: 12 }}
          size="small"
          dataSource={communities}
          renderItem={(community) => {
            const label = community.label ?? community.community_key;
            const isActive = community.id === activeCommunityId;
            return (
              <List.Item>
                <Button
                  type={isActive ? 'primary' : 'text'}
                  style={{ width: '100%', height: 'auto', textAlign: 'left', whiteSpace: 'normal' }}
                  onClick={() => onSelectCommunity(isActive ? null : community.id)}
                >
                  <div>
                    <span>{label}</span>
                    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      {t('graph.community.nodeCount', { count: community.node_count })}
                    </Typography.Text>
                    {community.summary !== null && community.summary.length > 0 ? (
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {community.summary}
                      </Typography.Text>
                    ) : null}
                  </div>
                </Button>
              </List.Item>
            );
          }}
        />
      ) : null}
    </div>
  );
}

function GraphToolbar({
  hops,
  isExpanding,
  selectedNode,
  alreadyExpanded,
  onHopsChange,
  onExpand,
}: {
  hops: number;
  isExpanding: boolean;
  selectedNode: GraphNode | null;
  alreadyExpanded: boolean;
  onHopsChange: (hops: number) => void;
  onExpand: (force: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <Space>
        <Typography.Text>{t('graph.toolbar.hops')}</Typography.Text>
        <Select
          value={hops}
          style={{ width: 112 }}
          onChange={onHopsChange}
          options={[
            { value: 1, label: t('graph.toolbar.oneHop') },
            { value: 2, label: t('graph.toolbar.twoHop') },
          ]}
        />
      </Space>
      <Button
        type="primary"
        disabled={selectedNode === null}
        loading={isExpanding}
        onClick={() => onExpand(alreadyExpanded)}
      >
        {alreadyExpanded ? t('graph.action.refreshNeighbors') : t('graph.action.expandNeighbors')}
      </Button>
    </div>
  );
}

function GraphLegend() {
  const { t } = useTranslation();

  return (
    <Space wrap>
      <Typography.Text type="secondary">{t('graph.legend.title')}</Typography.Text>
      {Object.entries(GRAPH_NODE_TYPE_COLORS).map(([nodeType, color]) => (
        <Tag key={nodeType} color={color}>{nodeType === 'default' ? t('graph.nodeType.unknown') : nodeType}</Tag>
      ))}
    </Space>
  );
}

function GraphSelectionDrawer({
  selectedNode,
  selectedEdge,
  nodeById,
  onClose,
}: {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  nodeById: Map<string, GraphNode>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isOpen = selectedNode !== null || selectedEdge !== null;

  return (
    <Drawer title={t('graph.drawer.title')} open={isOpen} onClose={onClose} width={420}>
      {selectedNode !== null ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('graph.detail.label')}>{selectedNode.label}</Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.nodeType')}>{selectedNode.node_type ?? t('common.state.none')}</Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.community')}>{selectedNode.community_id ?? t('common.state.none')}</Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.score')}>{selectedNode.score}</Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.id')}>
            <Typography.Text copyable>{selectedNode.id}</Typography.Text>
          </Descriptions.Item>
          {selectedNode.description !== undefined && selectedNode.description !== null && selectedNode.description.length > 0 ? (
            <Descriptions.Item label={t('graph.detail.description')}>{selectedNode.description}</Descriptions.Item>
          ) : null}
        </Descriptions>
      ) : null}

      {selectedEdge !== null ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('graph.detail.relationship')}>{selectedEdge.relationship}</Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.confidence')}>{selectedEdge.confidence_label}</Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.score')}>
            {selectedEdge.effective_confidence_score ?? t('common.state.none')}
          </Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.evidenceCount')}>{selectedEdge.evidence_count}</Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.source')}>
            {nodeById.get(selectedEdge.source_node_id)?.label ?? selectedEdge.source_node_id}
          </Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.target')}>
            {nodeById.get(selectedEdge.target_node_id)?.label ?? selectedEdge.target_node_id}
          </Descriptions.Item>
          <Descriptions.Item label={t('graph.detail.id')}>
            <Typography.Text copyable>{selectedEdge.id}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}

function graphReducer(state: GraphState, action: GraphAction): GraphState {
  if (action.type === 'clear') {
    return {
      nodesById: new Map(),
      edgesById: new Map(),
      expandedNodeIds: new Set(),
      truncated: false,
      edgeTruncated: false,
    };
  }

  if (action.type === 'markExpanded') {
    const expandedNodeIds = new Set(state.expandedNodeIds);
    expandedNodeIds.add(action.nodeId);
    return { ...state, expandedNodeIds };
  }

  const nodesById = new Map(state.nodesById);
  let edgesById = new Map(state.edgesById);
  let truncated = state.truncated;
  let edgeTruncated = state.edgeTruncated;

  for (const node of action.nodes) {
    if (node.space_id !== action.spaceId) {
      continue;
    }

    if (!nodesById.has(node.id) && nodesById.size >= MAX_GRAPH_NODES) {
      truncated = true;
      continue;
    }

    nodesById.set(node.id, node);
  }

  for (const edge of action.edges) {
    if (
      edge.space_id !== action.spaceId ||
      !nodesById.has(edge.source_node_id) ||
      !nodesById.has(edge.target_node_id)
    ) {
      continue;
    }

    edgesById.set(edge.id, edge);
  }

  if (edgesById.size > MAX_GRAPH_EDGES) {
    edgeTruncated = true;
    const cappedEdgesById = new Map<string, GraphEdge>();
    for (const [edgeId, edge] of edgesById) {
      if (!nodesById.has(edge.source_node_id) || !nodesById.has(edge.target_node_id)) {
        continue;
      }
      cappedEdgesById.set(edgeId, edge);
      if (cappedEdgesById.size >= MAX_GRAPH_EDGES) {
        break;
      }
    }
    edgesById = cappedEdgesById;
  }

  return {
    ...state,
    nodesById,
    edgesById,
    truncated,
    edgeTruncated,
  };
}

const panelStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 16,
  background: '#ffffff',
} satisfies CSSProperties;
