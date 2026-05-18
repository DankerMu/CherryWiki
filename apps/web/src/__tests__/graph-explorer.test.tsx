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
import { AuthProvider, type AuthUser } from '../lib/auth';
import { GRAPH_NODE_TYPE_COLORS, getLinkColor, getNodeColor, truncateNodeLabel, type GraphCanvasData } from '../pages/graph/GraphCanvas.js';
import type { GraphCommunity, GraphEdge, GraphNode } from '../lib/graphApi';

type ApiGetMock = (path: string, query?: Record<string, unknown>) => Promise<unknown>;

const apiMocks = vi.hoisted(() => ({
  get: vi.fn<ApiGetMock>(),
}));

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details: unknown;

    constructor(input: { status: number; code: string; message: string; details?: unknown }) {
      super(input.message);
      this.name = 'ApiError';
      this.status = input.status;
      this.code = input.code;
      this.details = input.details;
    }
  }

  return {
    ApiError,
    configureApiClient: vi.fn(),
    api: {
      get: apiMocks.get,
    },
  };
});

vi.mock('../lib/graphApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/graphApi')>();
  return {
    ...actual,
    searchGraphNodes: vi.fn(),
    getGraphNeighbors: vi.fn(),
    getGraphCommunities: vi.fn(),
    getGraphCommunityNodes: vi.fn(),
  };
});

vi.mock('../pages/graph/GraphCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pages/graph/GraphCanvas.js')>();

  return {
    ...actual,
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
  };
});

const searchGraphNodesMock = vi.mocked(graphApi.searchGraphNodes);
const getGraphNeighborsMock = vi.mocked(graphApi.getGraphNeighbors);
const getGraphCommunitiesMock = vi.mocked(graphApi.getGraphCommunities);
const getGraphCommunityNodesMock = vi.mocked(graphApi.getGraphCommunityNodes);

const TEST_USER: AuthUser = {
  id: 'user-1',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
  groups: [],
  spaces: [{ id: 'space-1', name: 'Space One', role: 'viewer' }],
};

const DENIED_USER: AuthUser = {
  ...TEST_USER,
  spaces: [{ id: 'space-allowed', name: 'Allowed Space', role: 'viewer' }],
};

describe('GraphCanvas color config', () => {
  it('defines colors for all standard node types', () => {
    const requiredTypes = ['concept', 'entity', 'document', 'topic', 'person', 'organization', 'default'];

    for (const type of requiredTypes) {
      expect(GRAPH_NODE_TYPE_COLORS[type]).toBeDefined();
      expect(GRAPH_NODE_TYPE_COLORS[type]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('returns selected node color before other node color states', () => {
    expect(getNodeColor('node-a', 'node-a', 'community-auth', 'community-auth', 'concept', '#00b96b')).toBe('#fab387');
  });

  it('returns primary color when node belongs to the active community', () => {
    expect(getNodeColor('node-a', null, 'community-auth', 'community-auth', 'concept', '#00b96b')).toBe('#00b96b');
  });

  it('returns type color for non-selected non-community nodes', () => {
    expect(getNodeColor('node-a', null, 'community-auth', 'community-billing', 'person', '#00b96b')).toBe(
      GRAPH_NODE_TYPE_COLORS.person,
    );
  });

  it('returns default node color for unknown node types', () => {
    expect(getNodeColor('node-a', null, null, null, 'unknown', '#00b96b')).toBe(GRAPH_NODE_TYPE_COLORS.default);
  });

  it('returns selected edge color for selected links', () => {
    expect(getLinkColor('edge-a', 'edge-a', 'rgba(0, 0, 0, 0.38)')).toBe('#fab387');
  });

  it('returns tertiary text color for non-selected links', () => {
    expect(getLinkColor('edge-a', 'edge-b', 'rgba(0, 0, 0, 0.38)')).toBe('rgba(0, 0, 0, 0.38)');
  });
});

describe('truncateNodeLabel', () => {
  it('returns short labels unchanged', () => {
    expect(truncateNodeLabel('short')).toBe('short');
  });

  it('truncates labels beyond 18 characters', () => {
    const long = 'This is a very long label name';

    expect(truncateNodeLabel(long)).toBe('This is a very lon…');
    expect(truncateNodeLabel(long).length).toBe(19);
  });
});

describe('SpaceGraphExplorerPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    apiMocks.get.mockImplementation((path) => {
      if (path === '/spaces/space-1') {
        return Promise.resolve(createSpaceDetail());
      }
      if (path === '/spaces/space-1/stats') {
        return Promise.resolve(createSpaceStats());
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });
    getGraphCommunitiesMock.mockResolvedValue({ communities: [] });
    getGraphCommunityNodesMock.mockResolvedValue({ nodes: [], edges: [], truncated: false });
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
    getGraphCommunityNodesMock.mockResolvedValue({
      nodes: [createNode({ id: 'node-a', label: 'OAuth', community_id: 'community-auth' })],
      edges: [],
      truncated: false,
    });

    renderPage();
    runSearch('service');
    await screen.findByText('Auth');
    fireEvent.click(screen.getByText('Auth').closest('button')!);

    await waitFor(() => {
      expect(screen.getByTestId('graph-node-node-a')).toHaveAttribute('data-highlighted', 'true');
      expect(screen.getByTestId('graph-node-node-b')).toHaveAttribute('data-highlighted', 'false');
    });
    expect(getGraphCommunityNodesMock).toHaveBeenCalledWith('community-auth', 'space-1');
  });

  it('shows empty state when no graph data is loaded', async () => {
    renderPage();

    expect(await screen.findByText('No graph data loaded. Search for a node or run Graphify for this space.')).toBeInTheDocument();
  });

  it('shows graphify empty state when the space has no graph nodes', async () => {
    apiMocks.get.mockImplementation((path) => {
      if (path === '/spaces/space-1') {
        return Promise.resolve(createSpaceDetail({ active_graphify_run_id: null }));
      }
      if (path === '/spaces/space-1/stats') {
        return Promise.resolve(createSpaceStats({ node_count: 0 }));
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });

    renderPage();

    expect(await screen.findByText('No active graph yet')).toBeInTheDocument();
    expect(screen.getByText('Run Graphify').closest('a')).toHaveAttribute('href', '/spaces/space-1/graphify');
  });

  it('shows graph UI when graph nodes exist without an active graphify run', async () => {
    apiMocks.get.mockImplementation((path) => {
      if (path === '/spaces/space-1') {
        return Promise.resolve(createSpaceDetail({ active_graphify_run_id: null }));
      }
      if (path === '/spaces/space-1/stats') {
        return Promise.resolve(createSpaceStats({ node_count: 5 }));
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });

    renderPage();

    expect(await screen.findByTestId('graph-canvas')).toBeInTheDocument();
    expect(screen.queryByText('No active graph yet')).not.toBeInTheDocument();
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

  it('preserves canvas state when neighbor expansion fails', async () => {
    searchGraphNodesMock.mockResolvedValue({
      nodes: [createNode({ id: 'node-a', label: 'SSO' })],
      total: 1,
    });
    getGraphNeighborsMock.mockRejectedValue(new Error('Neighbor API failed'));

    renderPage();
    runSearch('SSO');
    fireEvent.click(await screen.findByTestId('graph-node-node-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Neighbors' }));

    expect(await screen.findByText('Neighbor API failed')).toBeInTheDocument();
    expect(screen.getByTestId('graph-node-node-a')).toBeInTheDocument();
    expect(screen.getByTestId('graph-canvas')).toHaveAttribute('data-node-count', '1');
  });

  it('renders forbidden and skips protected graph requests when route space is unauthorized', async () => {
    renderPage(DENIED_USER, '/spaces/space-denied/graph');

    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(apiMocks.get).not.toHaveBeenCalled();
    expect(getGraphCommunitiesMock).not.toHaveBeenCalled();
    expect(getGraphCommunityNodesMock).not.toHaveBeenCalled();
    expect(searchGraphNodesMock).not.toHaveBeenCalled();
    expect(getGraphNeighborsMock).not.toHaveBeenCalled();
  });
});

function renderPage(user: AuthUser = TEST_USER, path = '/spaces/space-1/graph'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={{ user, accessToken: 'test-token' }}>
        <ThemeProvider>
          <Routes>
            <Route path="/spaces/:spaceId/graph" element={<SpaceGraphExplorerPage />} />
          </Routes>
        </ThemeProvider>
      </AuthProvider>
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

function createSpaceDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'space-1',
    name: 'Space 1',
    slug: 'space-1',
    status: 'active',
    description: null,
    stats: createSpaceStats(),
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    docmost_space_id: null,
    wiki_repo_path: '',
    active_graphify_run_id: 'run-1',
    active_index_snapshot_id: null,
    index_consistency_status: 'consistent',
    strict_knowledge_only: false,
    graphify_config: null,
    default_publish_policy: 'draft',
    ...overrides,
  };
}

function createSpaceStats(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    space_id: 'space-1',
    page_count: 0,
    source_count: 0,
    node_count: 2,
    edge_count: 1,
    index_consistency: 'consistent',
    ...overrides,
  };
}
