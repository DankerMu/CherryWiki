// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphifyRun } from '../lib/graphifyApi.js';
import GraphifyRunDetailPage from '../pages/GraphifyRunDetailPage.js';
import GraphifyRunsPage from '../pages/GraphifyRunsPage.js';
import { formatRunLabel } from '../pages/graphifyUi.js';

type GetWrappedMock = (path: string, query?: Record<string, unknown>) => Promise<unknown>;
type PostMock = (path: string, body?: unknown) => Promise<unknown>;

const apiMocks = vi.hoisted(() => ({
  getWrapped: vi.fn<GetWrappedMock>(),
  post: vi.fn<PostMock>(),
}));

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock('../lib/api.js', () => {
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
    api: {
      getWrapped: apiMocks.getWrapped,
      post: apiMocks.post,
    },
  };
});

vi.mock('../lib/auth.js', () => ({
  useAuth: authMocks.useAuth,
}));

beforeEach(() => {
  authMocks.useAuth.mockReturnValue(buildAuthValue());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GraphifyRunsPage', () => {
  it('shows no permission and skips list API requests when graphify view is denied', async () => {
    authMocks.useAuth.mockReturnValue(
      buildAuthValue({
        hasSpacePermission: () => false,
      }),
    );

    renderWithRouter(<GraphifyRunsPage />, '/spaces/space-1/graphify');

    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText('viewer@example.com does not have Graphify access for this space.')).toBeInTheDocument();
    expect(screen.queryByText('Graphify Runs')).not.toBeInTheDocument();
    expect(apiMocks.getWrapped).not.toHaveBeenCalled();
  });

  it('shows the runs list without New Run controls when graphify run is denied', async () => {
    authMocks.useAuth.mockReturnValue(
      buildAuthValue({
        hasSpacePermission: (_spaceId, permission) => permission === 'graphify:view',
      }),
    );
    apiMocks.getWrapped.mockResolvedValue({
      data: [buildRun({ run_id: 'run-succeeded', status: 'succeeded' })],
      meta: { pagination: { page: 1, per_page: 20, total: 1, has_next: false } },
    });

    renderWithRouter(<GraphifyRunsPage />, '/spaces/space-1/graphify');

    expect(await screen.findByText('Graphify Runs')).toBeInTheDocument();
    expect(await screen.findByText('run-succeeded')).toBeInTheDocument();
    expect(screen.queryByText('New Run')).not.toBeInTheDocument();
    expect(screen.queryByText('New Graphify Run')).not.toBeInTheDocument();
  });

  it('renders run list with antd Table and status tags', async () => {
    apiMocks.getWrapped.mockResolvedValue({
      data: [
        buildRun({ run_id: 'run-pending', status: 'pending' }),
        buildRun({ run_id: 'run-running', status: 'running' }),
        buildRun({ run_id: 'run-succeeded', status: 'succeeded' }),
        buildRun({
          run_id: 'run-failed',
          status: 'failed',
          error_json: { reason: 'quarantined', quarantine_type: 'schema_validation' },
        }),
        buildRun({ run_id: 'run-cancelled', status: 'cancelled' }),
      ],
      meta: { pagination: { page: 1, per_page: 20, total: 5, has_next: false } },
    });

    renderWithRouter(<GraphifyRunsPage />, '/spaces/space-1/graphify');

    expect(await screen.findByText('Graphify Runs')).toBeInTheDocument();
    // antd Tag renders status labels (also present in filter tabs, so use getAllByText)
    await waitFor(() => {
      expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Succeeded').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThanOrEqual(1);
  });

  it('opens new run dialog and creates run', async () => {
    apiMocks.getWrapped.mockResolvedValue({
      data: [],
      meta: { pagination: { page: 1, per_page: 20, total: 0, has_next: false } },
    });
    apiMocks.post.mockResolvedValue(buildRun({ run_id: 'run-new', mode: 'incremental' }));

    renderWithRouter(<GraphifyRunsPage />, '/spaces/space-1/graphify');

    // Find the New Run button (antd Button with PlusOutlined icon)
    const newRunButton = await screen.findByText('New Run');
    fireEvent.click(newRunButton);

    // antd Modal should open with the form
    expect(await screen.findByText('New Graphify Run')).toBeInTheDocument();

    // Submit the form via the OK button (antd Modal footer)
    const createButton = screen.getByText('Create Run');
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalledWith('/spaces/space-1/graphify/runs', {
        mode: 'full',
        trigger_type: 'manual',
      });
    });
  });
});

describe('GraphifyRunDetailPage', () => {
  it('shows no permission and skips detail API requests when graphify view is denied', async () => {
    authMocks.useAuth.mockReturnValue(
      buildAuthValue({
        hasSpacePermission: () => false,
      }),
    );

    renderWithRouter(<GraphifyRunDetailPage />, '/spaces/space-1/graphify/run-1');

    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText('viewer@example.com does not have Graphify access for this space.')).toBeInTheDocument();
    expect(screen.queryByText('Graphify Run Detail')).not.toBeInTheDocument();
    expect(apiMocks.getWrapped).not.toHaveBeenCalled();
  });

  it('renders run detail when the run space matches the route space', async () => {
    mockDetailApis(buildRun({ run_id: 'run-1', space_id: 'space-1', status: 'succeeded' }));

    renderWithRouter(<GraphifyRunDetailPage />, '/spaces/space-1/graphify/run-1');

    expect(await screen.findByText('Graphify Run Detail')).toBeInTheDocument();
    expect(screen.getAllByText('run-1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('space-1').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Page Not Found')).not.toBeInTheDocument();
  });

  it('shows not found and blocks detail rendering when the run space does not match the route space', async () => {
    mockDetailApis(buildRun({ run_id: 'run-1', space_id: 'space-2', status: 'succeeded' }));

    renderWithRouter(<GraphifyRunDetailPage />, '/spaces/space-1/graphify/run-1');

    expect(await screen.findByText('Page Not Found')).toBeInTheDocument();
    expect(screen.queryByText('Graphify Run Detail')).not.toBeInTheDocument();
    expect(screen.queryByText('space-2')).not.toBeInTheDocument();
    expect(apiMocks.getWrapped).toHaveBeenCalledTimes(1);
    expect(apiMocks.getWrapped).toHaveBeenCalledWith('/graphify/runs/run-1');
  });

  it('hides cancel and retry actions on detail when graphify run is denied', async () => {
    authMocks.useAuth.mockReturnValue(
      buildAuthValue({
        hasSpacePermission: (_spaceId, permission) => permission === 'graphify:view',
      }),
    );

    await renderDetailStatus('running');
    expect(screen.queryByText('Cancel Run')).not.toBeInTheDocument();
    expect(screen.queryByText('Retry Run')).not.toBeInTheDocument();

    cleanup();
    apiMocks.getWrapped.mockReset();

    await renderDetailStatus('failed');
    expect(screen.queryByText('Cancel Run')).not.toBeInTheDocument();
    expect(screen.queryByText('Retry Run')).not.toBeInTheDocument();
  });

  it('shows cancel button for running status', async () => {
    await renderDetailStatus('running');
    expect(await screen.findByText('Cancel Run')).toBeInTheDocument();
    expect(screen.queryByText('Retry Run')).not.toBeInTheDocument();
  });

  it('shows retry button for failed status', async () => {
    await renderDetailStatus('failed');
    expect(await screen.findByText('Retry Run')).toBeInTheDocument();
    expect(screen.queryByText('Cancel Run')).not.toBeInTheDocument();
  });

  it('shows neither cancel nor retry for succeeded status', async () => {
    await renderDetailStatus('succeeded');
    await waitFor(() => {
      expect(screen.queryByText('Loading graphify run details...')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Cancel Run')).not.toBeInTheDocument();
    expect(screen.queryByText('Retry Run')).not.toBeInTheDocument();
  });
});

describe('formatRunLabel', () => {
  const t = ((key: string) => (key === 'common.status.deleted' ? 'Deleted' : key)) as Parameters<
    typeof formatRunLabel
  >[1];

  it('falls back to space name and mode when resolved names are empty', () => {
    const label = formatRunLabel(buildRun({ mode: 'full' }), t, { 'space-1': 'Research Space' });

    expect(label).toEqual({ primary: 'Research Space · Full', secondary: 'run-1' });
  });

  it('falls back to mode when resolved names and space name are unavailable', () => {
    const label = formatRunLabel(buildRun({ mode: 'incremental' }), t);

    expect(label).toEqual({ primary: 'Incremental', secondary: 'run-1' });
  });

  it('uses resolved document and page names ahead of the space fallback', () => {
    const label = formatRunLabel(
      buildRun({
        input_scope_resolved: {
          source_documents: [{ id: 'doc-1', filename: 'Plan.pdf', missing: false }],
          pages: [{ id: 'page-1', title: 'Overview', missing: false }],
        },
      }),
      t,
      { 'space-1': 'Research Space' },
    );

    expect(label).toEqual({ primary: 'Plan.pdf, Overview', secondary: 'run-1' });
  });
});

type AuthValue = {
  user: { email: string };
  hasSpacePermission: (spaceId: string, permission: string) => boolean;
};

function buildAuthValue(overrides: Partial<AuthValue> = {}): AuthValue {
  return {
    user: { email: 'viewer@example.com' },
    hasSpacePermission: () => true,
    ...overrides,
  };
}

async function renderDetailStatus(status: GraphifyRun['status']): Promise<void> {
  mockDetailApis(buildRun({
    run_id: 'run-1',
    status,
    error_json: status === 'failed' ? { reason: 'quarantined', quarantine_type: 'shrink_guard' } : null,
  }));

  renderWithRouter(<GraphifyRunDetailPage />, '/spaces/space-1/graphify/run-1');
  expect(await screen.findByText('Graphify Run Detail')).toBeInTheDocument();
}

function mockDetailApis(run: GraphifyRun): void {
  apiMocks.getWrapped.mockImplementation((path: string) => {
    if (path === '/graphify/runs/run-1') {
      return Promise.resolve({
        data: run,
      });
    }

    if (path === '/graphify/runs/run-1/report') {
      return Promise.resolve({
        data: {
          run_id: 'run-1',
          report_format: 'markdown',
          content: '# Summary',
          generated_at: '2026-05-01T10:10:00.000Z',
        },
      });
    }

    if (path === '/graphify/runs/run-1/graph') {
      return Promise.resolve({
        data: {
          run_id: 'run-1',
          summary: { node_count: 10, edge_count: 9, community_count: 2 },
          top_entities: [],
          schema_version: 'v1',
        },
      });
    }

    return Promise.reject(new Error('not found'));
  });
}

function renderWithRouter(element: ReactElement, path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/spaces/:spaceId/graphify" element={element} />
        <Route path="/spaces/:spaceId/graphify/:runId" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

function buildRun(overrides: Partial<GraphifyRun> = {}): GraphifyRun {
  return {
    run_id: 'run-1',
    space_id: 'space-1',
    mode: 'full',
    trigger_type: 'manual',
    status: 'pending',
    progress: { percent: 0, stage: 'pending' },
    input_scope: {
      page_ids: [],
      source_document_ids: [],
    },
    input_scope_resolved: {
      source_documents: [],
      pages: [],
    },
    result: {
      nodes_created: 10,
      nodes_updated: 0,
      edges_created: 9,
      wiki_pages_generated: 4,
      schema_version: 'v1',
      graph_json_uri: 's3://out/graph.json',
      report_uri: 's3://out/GRAPH_REPORT.md',
    },
    stats_json: {
      node_count: 10,
      edge_count: 9,
      wiki_page_count: 4,
      community_count: 2,
    },
    error_json: null,
    created_at: '2026-05-01T10:00:00.000Z',
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}
