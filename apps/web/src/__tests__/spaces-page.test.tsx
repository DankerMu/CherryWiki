// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import AppShell from '../components/AppShell';
import { AuthProvider, type AuthUser } from '../lib/auth';
import type { AdminGroup, AdminSpace } from '../lib/adminTypes';
import SpacesPage from '../pages/admin/SpacesPage';
import { ThemeProvider } from '../theme/ThemeProvider';

const ADMIN_NO_SPACES: AuthUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  groups: [],
  spaces: [],
};

const CREATED_SPACE = buildAdminSpace({
  id: 'space-new',
  name: 'New Space',
  slug: 'new-space',
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SpacesPage', () => {
  it('refreshes the current user after successful space creation', async () => {
    const fetchMock = stubSpacesPageApi({ createSucceeds: true });

    renderSpacesPage();

    await createSpace();

    await waitFor(() => {
      expect(getRequestPaths(fetchMock)).toContain('/api/auth/me');
    });
    expect(getRequestPaths(fetchMock).filter((path) => path === '/api/auth/me')).toHaveLength(1);
  });

  it('enables the shell space selector and includes the new space after creation', async () => {
    stubSpacesPageApi({ createSucceeds: true });

    renderSpacesPage();

    await waitFor(() => {
      expect(getShellSpaceSelectContainer()).toHaveClass('ant-select-disabled');
    });
    expect(screen.getAllByText('No spaces available').length).toBeGreaterThan(0);

    await createSpace();

    await waitFor(() => {
      expect(getShellSpaceSelectContainer()).not.toHaveClass('ant-select-disabled');
    });
    expect(within(getShellSpaceSelectContainer()).getByText('New Space')).toBeInTheDocument();
  });

  it('keeps the selector disabled and does not refresh the current user when creation fails', async () => {
    const fetchMock = stubSpacesPageApi({ createSucceeds: false });

    renderSpacesPage();

    await waitFor(() => {
      expect(getShellSpaceSelectContainer()).toHaveClass('ant-select-disabled');
    });

    await createSpace();

    await waitFor(() => {
      expect(getRequestPaths(fetchMock).filter((path) => path === '/api/spaces')).toHaveLength(2);
    });
    expect(getShellSpaceSelectContainer()).toHaveClass('ant-select-disabled');
    expect(screen.getAllByText('No spaces available').length).toBeGreaterThan(0);
    expect(getRequestPaths(fetchMock)).not.toContain('/api/auth/me');
    expect(screen.queryByText('New Space')).not.toBeInTheDocument();
  });
});

function renderSpacesPage(user: AuthUser = ADMIN_NO_SPACES) {
  return render(
    <MemoryRouter initialEntries={['/admin/spaces']}>
      <AuthProvider initialSession={{ user, accessToken: 'test-token' }}>
        <ThemeProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/admin/spaces" element={<SpacesPage />} />
            </Route>
            <Route path="/login" element={<h1>Login</h1>} />
          </Routes>
        </ThemeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function createSpace(): Promise<void> {
  expect(await screen.findByRole('heading', { name: 'Space Management' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Create Space/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Create Space' });
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'New Space' } });
  fireEvent.change(within(dialog).getByLabelText('Slug'), { target: { value: 'new-space' } });
  fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'A new knowledge space' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create Space' }));
}

function stubSpacesPageApi({ createSucceeds }: { createSucceeds: boolean }) {
  let spaces: AdminSpace[] = [];

  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const path = getRequestPath(input);
    const method = init?.method ?? 'GET';

    if (path === '/api/spaces' && method === 'GET') {
      return Promise.resolve(jsonResponse({ data: spaces, meta: { request_id: 'req-spaces' } }));
    }

    if (path === '/api/admin/groups' && method === 'GET') {
      return Promise.resolve(jsonResponse({ data: [] satisfies AdminGroup[], meta: { request_id: 'req-groups' } }));
    }

    if (path === '/api/spaces' && method === 'POST') {
      if (!createSucceeds) {
        return Promise.resolve(jsonResponse({ error: { code: 'CREATE_FAILED', message: 'Create failed' } }, 500));
      }

      spaces = [CREATED_SPACE];
      return Promise.resolve(jsonResponse({ data: buildAdminSpaceDetail(CREATED_SPACE), meta: { request_id: 'req-create' } }, 201));
    }

    if (path === '/api/auth/me' && method === 'GET') {
      return Promise.resolve(
        jsonResponse({
          data: {
            ...ADMIN_NO_SPACES,
            groups: [],
            spaces: [{ id: CREATED_SPACE.id, name: CREATED_SPACE.name, role: 'admin' }],
          },
          meta: { request_id: 'req-me' },
        }),
      );
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buildAdminSpace(overrides: Partial<AdminSpace> = {}): AdminSpace {
  return {
    id: 'space-1',
    name: 'Space One',
    slug: 'space-one',
    status: 'active',
    description: null,
    stats: { page_count: 0, source_count: 0, node_count: 0 },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildAdminSpaceDetail(space: AdminSpace) {
  return {
    ...space,
    docmost_space_id: null,
    wiki_repo_path: '/tmp/new-space',
    active_graphify_run_id: null,
    active_index_snapshot_id: null,
    index_consistency_status: 'consistent',
    strict_knowledge_only: false,
    graphify_config: {},
    default_publish_policy: 'manual',
  };
}

function getShellSpaceSelectContainer(): HTMLElement {
  const combobox = screen
    .getAllByLabelText('Space')
    .find((element) => element.getAttribute('role') === 'combobox');
  const container = combobox?.closest('.ant-select');

  if (!(container instanceof HTMLElement)) {
    throw new Error('Shell space selector was not found');
  }

  return container;
}

function getRequestPaths(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
  return fetchMock.mock.calls.map(([input]) => getRequestPath(input));
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
