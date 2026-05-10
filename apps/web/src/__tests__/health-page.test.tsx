// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { AuthProvider, type AuthUser } from '../lib/auth';
import type { SystemHealth } from '../lib/adminTypes';
import HealthPage from '../pages/admin/HealthPage';

const ADMIN_USER: AuthUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  groups: [],
  spaces: [{ id: 'space-main', name: 'Main Space', role: 'admin' }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HealthPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders Postgres-backed and optional component details', async () => {
    const fetchMock = stubHealthApi();

    renderHealthRoute();

    expect(await screen.findByRole('heading', { name: 'System Health' })).toBeInTheDocument();
    expect(await screen.findByText('Postgres-backed vector store')).toBeInTheDocument();
    expect(screen.getByText('Postgres-backed graph store')).toBeInTheDocument();
    expect(screen.getByText('Optional integration')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it('renders dependent stores as unhealthy when the database health check fails', async () => {
    stubHealthApi({
      status: 'unhealthy',
      uptime: 42,
      components: {
        database: { status: 'unhealthy', error: 'db down' },
        vector_store: {
          status: 'unhealthy',
          error: 'Depends on database health check',
          details: 'Postgres-backed vector store',
        },
        graph_store: {
          status: 'unhealthy',
          error: 'Depends on database health check',
          details: 'Postgres-backed graph store',
        },
        docmost_bridge: { status: 'not_configured', details: 'Optional integration' },
      },
    });

    renderHealthRoute();

    expect(await screen.findByRole('heading', { name: 'System Health' })).toBeInTheDocument();

    const databaseCard = await getComponentCard('Database');
    expect(within(databaseCard).getByText('Unhealthy')).toBeInTheDocument();

    const vectorStoreCard = await getComponentCard('Vector Store');
    expect(within(vectorStoreCard).getByText('Unhealthy')).toBeInTheDocument();
    expect(vectorStoreCard).toHaveTextContent('Depends on database health check');
    expect(vectorStoreCard).toHaveTextContent('Postgres-backed vector store');

    const graphStoreCard = await getComponentCard('Graph Store');
    expect(within(graphStoreCard).getByText('Unhealthy')).toBeInTheDocument();
    expect(graphStoreCard).toHaveTextContent('Depends on database health check');
    expect(graphStoreCard).toHaveTextContent('Postgres-backed graph store');

    expect(await getComponentCard('Docmost Bridge')).toHaveTextContent('Optional integration');
  });
});

function renderHealthRoute(): void {
  render(
    <MemoryRouter initialEntries={['/admin/health']}>
      <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
        <Routes>
          <Route path="/admin/health" element={<HealthPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function stubHealthApi(health: SystemHealth = {
  status: 'healthy',
  uptime: 42,
  components: {
    database: { status: 'healthy', latency_ms: 5 },
    redis: { status: 'healthy', latency_ms: 2 },
    minio: { status: 'healthy', latency_ms: 12 },
    vector_store: { status: 'healthy', latency_ms: 5, details: 'Postgres-backed vector store' },
    graph_store: { status: 'healthy', latency_ms: 5, details: 'Postgres-backed graph store' },
    docmost_bridge: { status: 'not_configured', details: 'Optional integration' },
  },
}) {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    if (getRequestPath(input) === '/api/admin/system/health') {
      return Promise.resolve(
        jsonResponse({
          data: health,
        }),
      );
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input.split('?')[0] ?? '';
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return input.url.split('?')[0] ?? '';
}

async function getComponentCard(label: string): Promise<HTMLElement> {
  const title = await screen.findByText(label);
  const card = title.closest('.ant-card');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}
