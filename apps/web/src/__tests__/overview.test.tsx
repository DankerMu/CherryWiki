// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { ThemeProvider } from '../theme/ThemeProvider';
import SpaceOverviewPage from '../pages/space/SpaceOverviewPage';

describe('SpaceOverviewPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows loaded stats cards with correct values', async () => {
    stubOverviewApi();

    renderPage();

    expect(await screen.findByText('Space Overview')).toBeInTheDocument();
    expect((await screen.findAllByText('Documents')).length).toBeGreaterThan(0);
    expect(screen.getByText('Wiki Pages')).toBeInTheDocument();
    expect(screen.getByText('Graph Nodes')).toBeInTheDocument();
    expect(screen.getByText('Graph Edges')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
  });

  it('shows empty states when there are no recent documents or wiki pages', async () => {
    stubOverviewApi({ documents: [], wikiPages: [] });

    renderPage();

    expect(await screen.findByText('No documents in this space yet.')).toBeInTheDocument();
    expect(screen.getByText('No wiki pages in this space yet.')).toBeInTheDocument();
  });

  it('keeps recent documents visible when stats fail', async () => {
    stubOverviewApi({ failStats: true });

    renderPage();

    expect(await screen.findByText('Stats unavailable')).toBeInTheDocument();
    expect(screen.getByText('Stats broken')).toBeInTheDocument();
    expect(await screen.findByText('policy.md')).toBeInTheDocument();
  });

  it('reloads overview data when refresh is clicked', async () => {
    const fetchMock = stubOverviewApi({ statsSequence: [12, 13] });

    renderPage();

    expect(await screen.findByText('12')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('13')).toBeInTheDocument();
    await waitFor(() => {
      expect(countRequests(fetchMock, '/api/spaces/space-1/stats')).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders quick actions with the expected routes', async () => {
    stubOverviewApi();

    renderPage();

    expect(await screen.findByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Documents' }).closest('a')).toHaveAttribute(
      'href',
      '/spaces/space-1/uploads',
    );
    expect(screen.getByRole('button', { name: 'Wiki' }).closest('a')).toHaveAttribute('href', '/spaces/space-1/wiki');
    expect(screen.getByRole('button', { name: 'Graph Explorer' }).closest('a')).toHaveAttribute(
      'href',
      '/spaces/space-1/graph',
    );
    expect(screen.getByRole('button', { name: 'Graphify' }).closest('a')).toHaveAttribute(
      'href',
      '/spaces/space-1/graphify',
    );
    expect(screen.getByRole('button', { name: 'Chat' }).closest('a')).toHaveAttribute('href', '/spaces/space-1/chat');
  });
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/spaces/space-1/overview']}>
      <ThemeProvider>
        <Routes>
          <Route path="/spaces/:spaceId/overview" element={<SpaceOverviewPage />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function stubOverviewApi(options: {
  documents?: unknown[];
  wikiPages?: unknown[];
  failStats?: boolean;
  statsSequence?: number[];
} = {}) {
  let statsCall = 0;
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = getRequestPath(input);

    if (path === '/api/spaces/space-1') {
      return Promise.resolve(jsonResponse({ data: createSpaceDetail() }));
    }

    if (path === '/api/spaces/space-1/stats') {
      if (options.failStats === true) {
        return Promise.resolve(jsonResponse({ error: { code: 'STATS_FAILED', message: 'Stats broken' } }, 500));
      }
      const sourceCount = options.statsSequence?.[Math.min(statsCall, options.statsSequence.length - 1)] ?? 12;
      statsCall += 1;
      return Promise.resolve(jsonResponse({ data: createStats({ source_count: sourceCount }) }));
    }

    if (path === '/api/spaces/space-1/uploads') {
      return Promise.resolve(jsonResponse({ data: options.documents ?? [createDocument()] }));
    }

    if (path === '/api/spaces/space-1/wiki/pages') {
      return Promise.resolve(jsonResponse({ data: options.wikiPages ?? [createWikiPage()] }));
    }

    if (path === '/api/graph/communities') {
      return Promise.resolve(jsonResponse({ data: { communities: [{ id: 'community-1' }] } }));
    }

    if (path === '/api/graphify/runs/run-1') {
      return Promise.resolve(jsonResponse({ data: createGraphifyRun() }));
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: `Unexpected path: ${path}` } }, 404));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createSpaceDetail() {
  return {
    id: 'space-1',
    name: 'Space 1',
    slug: 'space-1',
    status: 'active',
    description: null,
    active_graphify_run_id: 'run-1',
    active_index_snapshot_id: 'snapshot-1',
    index_consistency_status: 'consistent',
    strict_knowledge_only: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };
}

function createStats(overrides: Record<string, unknown> = {}) {
  return {
    space_id: 'space-1',
    source_count: 12,
    page_count: 8,
    node_count: 120,
    edge_count: 340,
    index_consistency: 'consistent',
    ...overrides,
  };
}

function createDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    filename: 'policy.md',
    mime_type: 'text/markdown',
    source_type: 'upload',
    status: 'parsed',
    updated_at: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

function createWikiPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wiki-row-1',
    page_id: 'policy',
    space_id: 'space-1',
    title: 'Policy',
    status: 'published',
    updated_at: '2026-01-04T00:00:00.000Z',
    ...overrides,
  };
}

function createGraphifyRun() {
  return {
    run_id: 'run-1',
    space_id: 'space-1',
    mode: 'full',
    trigger_type: 'manual',
    status: 'running',
    progress: { percent: 40, stage: 'importing' },
    input_scope: {},
    result: {
      nodes_created: 0,
      nodes_updated: 0,
      edges_created: 0,
      wiki_pages_generated: 0,
      schema_version: 'v1',
      graph_json_uri: null,
      report_uri: null,
    },
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:01:00.000Z',
    completed_at: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input.split('?')[0] ?? input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return input.url.split('?')[0] ?? input.url;
}

function countRequests(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, path: string): number {
  return fetchMock.mock.calls.filter((call) => getRequestPath(call[0]) === path).length;
}
