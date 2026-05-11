// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { ThemeProvider } from '../theme/ThemeProvider';
import SpaceGraphExplorerPage from '../pages/graph/SpaceGraphExplorerPage';
import * as graphApi from '../lib/graphApi';
import type { GraphCanvasData } from '../pages/graph/GraphCanvas';
import type { GraphCommunity, GraphEdge, GraphNode } from '../lib/graphApi';

vi.mock('../lib/graphApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/graphApi')>();
  return {
    ...actual,
    searchGraphNodes: vi.fn(),
    getGraphNeighbors: vi.fn(),
    getGraphCommunities: vi.fn(),
  };
});

vi.mock('../pages/graph/GraphCanvas', () => ({
  default: ({
    graphData,
    activeCommunityId,
    onNodeSelect,
    onEdgeSelect,
  }: {
    graphData: GraphCanvasData;
    activeCommunityId: string | null;
    onNodeSelect: (nodeId: string) => void;
    onEdgeSelect: (edgeId: string) => void;
  }) => (
    <div data-testid="graph-canvas" data-node-count={graphData.nodes.length} data-edge-count={graphData.links.length}>
      {graphData.nodes.length === 0 ? <span>No graph data loaded. Search for a node or run Graphify for this space.</span> : null}
      {graphData.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          data-testid={`graph-node-${node.id}`}
          data-highlighted={activeCommunityId === node.community_id ? 'true' : 'false'}
          onClick={() => onNodeSelect(node.id)}
        >
          {node.label}
        </button>
      ))}
      {graphData.links.map((edge) => (
        <button key={edge.id} type="button" data-testid={`graph-edge-${edge.id}`} onClick={() => onEdgeSelect(edge.id)}>
          {edge.relationship}
        </button>
      ))}
    </div>
  ),
  GRAPH_NODE_TYPE_COLORS: {
    concept: '#2563eb',
    entity: '#059669',
    default: '#64748b',
  },
  getGraphNodeTypeColor: () => '#2563eb',
}));

const searchGraphNodesMock = vi.mocked(graphApi.searchGraphNodes);
const getGraphNeighborsMock = vi.mocked(graphApi.getGraphNeighbors);
const getGraphCommunitiesMock = vi.mocked(graphApi.getGraphCommunities);

describe('SpaceGraphExplorerPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    getGraphCommunitiesMock.mockResolvedValue({ communities: [] });
    searchGraphNodesMock.mockResolvedValue({ nodes: [], total: 0 });
    getGraphNeighborsMock.mockResolvedValue({ center_node: null, neighbors: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('search renders results and adds nodes to canvas data', async () => {
    searchGraphNodesMock.mockResolvedValue({
      nodes: [createNode({ id: 'node-oauth', label: 'OAuth' })],
      total: 1,
    });

    renderPage();
    runSearch('OAuth');

    expect(await screen.findByTestId('graph-node-node-oauth')).toBeInTheDocument();
    expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-node-count', '1');
    expect(searchGraphNodesMock).toHaveBeenCalledWith({ spaceId: 'space-1', query: 'OAuth', limit: 20 });
  });

  it('neighbor expansion adds new nodes and edges without duplicates', async () => {
    searchGraphNodesMock.mockResolvedValue({
      nodes: [createNode({ id: 'node-a', label: 'SSO' })],
      total: 1,
    });
    getGraphNeighborsMock.mockResolvedValue({
      center_node: createNode({ id: 'node-a', label: 'SSO' }),
      neighbors: [
        {
          node: createNode({ id: 'node-b', label: 'Token' }),
          edge: createEdge({ id: 'edge-ab', source_node_id: 'node-a', target_node_id: 'node-b' }),
          hop: 1,
        },
      ],
    });

    renderPage();
    runSearch('SSO');
    fireEvent.click(await screen.findByTestId('graph-node-node-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Neighbors' }));

    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-node-count', '2');
      expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-edge-count', '1');
    });

    await waitFor(() => expect(screen.getByText('Refresh Neighbors')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Refresh Neighbors').closest('button')!);
    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-node-count', '2');
      expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-edge-count', '1');
    });
  });

  it('filters nodes from other spaces', async () => {
    searchGraphNodesMock.mockResolvedValue({
      nodes: [
        createNode({ id: 'node-a', label: 'Current Space' }),
        createNode({ id: 'node-b', label: 'Other Space', space_id: 'space-2' }),
      ],
      total: 2,
    });

    renderPage();
    runSearch('space');

    expect(await screen.findByTestId('graph-node-node-a')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-node-node-b')).not.toBeInTheDocument();
    expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-node-count', '1');
  });

  it('community selection highlights matching nodes', async () => {
    getGraphCommunitiesMock.mockResolvedValue({
      communities: [createCommunity({ id: 'community-auth', label: 'Auth' })],
    });
    searchGraphNodesMock.mockResolvedValue({
      nodes: [
        createNode({ id: 'node-a', label: 'OAuth', community_id: 'community-auth' }),
        createNode({ id: 'node-b', label: 'Billing', community_id: 'community-billing' }),
      ],
      total: 2,
    });

    renderPage();
    runSearch('service');
    await screen.findByText('Auth');
    fireEvent.click(screen.getByText('Auth').closest('button')!);

    expect(screen.getByTestId('graph-node-node-a')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('graph-node-node-b')).toHaveAttribute('data-highlighted', 'false');
  });

  it('shows empty state when no graph data is loaded', async () => {
    renderPage();

    expect(await screen.findByText('No graph data loaded. Search for a node or run Graphify for this space.')).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    searchGraphNodesMock.mockRejectedValue(new Error('Graph API failed'));

    renderPage();
    runSearch('OAuth');

    expect(await screen.findByText('Graph API failed')).toBeInTheDocument();
  });

  it('shows no-results state for search', async () => {
    searchGraphNodesMock.mockResolvedValue({ nodes: [], total: 0 });

    renderPage();
    runSearch('missing');

    expect(await screen.findByText('No matching nodes found.')).toBeInTheDocument();
  });
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/spaces/space-1/graph']}>
      <ThemeProvider>
        <Routes>
          <Route path="/spaces/:spaceId/graph" element={<SpaceGraphExplorerPage />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function runSearch(query: string): void {
  fireEvent.change(screen.getByPlaceholderText('Search nodes'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

function createNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node-a',
    node_key: 'node',
    stable_key: 'space-1:concept:node',
    label: 'Node',
    node_type: 'concept',
    description: null,
    space_id: 'space-1',
    community_id: null,
    score: 1,
    ...overrides,
  };
}

function createEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 'edge-ab',
    source_node_id: 'node-a',
    target_node_id: 'node-b',
    relationship: 'relates_to',
    confidence_label: 'EXTRACTED',
    effective_confidence_score: 0.9,
    evidence_count: 1,
    space_id: 'space-1',
    ...overrides,
  };
}

function createCommunity(overrides: Partial<GraphCommunity> = {}): GraphCommunity {
  return {
    id: 'community-auth',
    community_key: 'auth',
    label: 'Auth',
    summary: 'Authentication',
    node_count: 2,
    ...overrides,
  };
}
