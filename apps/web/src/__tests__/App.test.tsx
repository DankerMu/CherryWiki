// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { AppRoutes } from '../App';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AuthProvider, useAuth, type AuthUser } from '../lib/auth';

const ADMIN_USER: AuthUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  groups: [],
  spaces: [{ id: 'space-main', name: 'Main Space', role: 'admin' }],
};

const VIEWER_USER: AuthUser = {
  id: 'user-viewer',
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'viewer',
  groups: [],
  spaces: [{ id: 'space-main', name: 'Main Space', role: 'viewer' }],
};

const ADMIN_NO_SPACES: AuthUser = {
  id: 'user-admin-ns',
  email: 'admin-ns@example.com',
  name: 'Admin No Spaces',
  role: 'admin',
  groups: [],
  spaces: [],
};

const VIEWER_NO_SPACES: AuthUser = {
  id: 'user-viewer-ns',
  email: 'viewer-ns@example.com',
  name: 'Viewer No Spaces',
  role: 'viewer',
  groups: [],
  spaces: [],
};

function renderRoute(path: string, user?: AuthUser) {
  const routes = <AppRoutes />;

  return render(
    <MemoryRouter initialEntries={[path]}>
      {user === undefined ? (
        <AuthProvider>
          <ThemeProvider>{routes}</ThemeProvider>
        </AuthProvider>
      ) : (
        <AuthProvider initialSession={{ user, accessToken: 'test-token' }}>
          <ThemeProvider>{routes}</ThemeProvider>
        </AuthProvider>
      )}
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App routing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('redirects unauthenticated / to /login', async () => {
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('redirects authenticated admin with spaces to first space overview', { timeout: 30000 }, async () => {
    mockOverviewApi();
    renderRoute('/', ADMIN_USER);
    expect(await screen.findByRole('heading', { name: '空间概览' }, { timeout: 15000 })).toBeInTheDocument();
  });

  it('redirects authenticated admin without spaces to /admin/spaces', async () => {
    mockAdminApi();
    renderRoute('/', ADMIN_NO_SPACES);
    expect(await screen.findByRole('heading', { name: '空间管理' })).toBeInTheDocument();
  });

  it('shows no-spaces message for non-admin without spaces', () => {
    renderRoute('/', VIEWER_NO_SPACES);
    // The h1 contains the contact admin message
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders Login for /login', () => {
    renderRoute('/login');
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('redirects unauthenticated chat access to /login', () => {
    renderRoute('/spaces/test-space/chat');
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('renders Chat for /spaces/:spaceId/chat', async () => {
    mockChatSessionsApi();
    renderRoute('/spaces/test-space/chat', ADMIN_USER);
    expect(await screen.findByRole('heading', { name: '聊天' })).toBeInTheDocument();
  });

  it('redirects unauthenticated admin users to /login', () => {
    renderRoute('/admin');
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('redirects non-admin from admin routes to /', { timeout: 30000 }, async () => {
    mockOverviewApi();
    renderRoute('/admin/users', VIEWER_USER);
    expect(await screen.findByRole('heading', { name: '空间概览' }, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '用户管理' })).not.toBeInTheDocument();
  });

  it('renders Users for /admin/users when authorized', async () => {
    mockAdminApi();
    renderRoute('/admin/users', ADMIN_USER);
    expect(await screen.findByRole('heading', { name: '用户管理' })).toBeInTheDocument();
  });

  it('renders admin sub-pages when authorized', async () => {
    mockAdminApi();

    const routes = [
      ['/admin/users', '用户管理'],
      ['/admin/health', '系统健康'],
    ] as const;

    for (const [path, heading] of routes) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
            <ThemeProvider>
              <AppRoutes />
            </ThemeProvider>
          </AuthProvider>
        </MemoryRouter>,
      );
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      unmount();
    }
  });

  it('renders NotFound for /nonexistent', () => {
    renderRoute('/nonexistent');
    expect(screen.getByText('页面未找到')).toBeInTheDocument();
  });

  it('does not select or rewrite an inaccessible route space in the shell', async () => {
    const fetchMock = mockOverviewApi();

    renderRoute('/spaces/space-denied/overview', VIEWER_USER);

    expect(await screen.findByText('访问被拒绝')).toBeInTheDocument();
    expect(screen.queryByText('Main Space')).not.toBeInTheDocument();
    expect(screen.queryByText('空间功能')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '概览' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AuthProvider', () => {
  it('logs in, injects the access token, and logs out in memory', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/login') {
        return Promise.resolve(jsonResponse({
          data: {
            access_token: 'access-123',
            expires_in: 3600,
            user: ADMIN_USER,
          },
          meta: { request_id: 'req-login' },
        }));
      }

      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({
          data: { ...ADMIN_USER, spaces: [] },
          meta: { request_id: 'req-me' },
        }));
      }

      if (path === '/api/auth/logout') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-123');
        return Promise.resolve(jsonResponse({ data: { success: true }, meta: { request_id: 'req-logout' } }));
      }

      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('authenticated')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function AuthHarness() {
  const { user, isAuthenticated, login, logout } = useAuth();

  return (
    <div>
      <span>{isAuthenticated ? 'authenticated' : 'anonymous'}</span>
      <span>{user?.email ?? 'No user'}</span>
      <button
        type="button"
        onClick={() => {
          void login('admin@example.com', 'password');
        }}
      >
        Login
      </button>
      <button
        type="button"
        onClick={() => {
          void logout();
        }}
      >
        Logout
      </button>
    </div>
  );
}

function mockAdminApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (path.startsWith('/api/admin/users')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'user-admin',
              email: 'admin@example.com',
              name: 'Admin User',
              role: 'admin',
              status: 'active',
              groups: ['group-admin'],
              last_login_at: null,
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          meta: { request_id: 'req-users' },
        }));
      }

      if (path.startsWith('/api/admin/groups')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'group-admin',
              name: 'Administrators',
              description: 'Admin group',
              member_count: 1,
              spaces: [{ space_id: 'space-main', permissions: ['space:admin'] }],
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          meta: { request_id: 'req-groups' },
        }));
      }

      if (path.startsWith('/api/spaces')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'space-main',
              name: 'Main Space',
              slug: 'main-space',
              status: 'active',
              description: 'Primary space',
              stats: { page_count: 0, source_count: 0, node_count: 0 },
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          meta: { request_id: 'req-spaces' },
        }));
      }

      if (path.startsWith('/api/admin/models')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'model-1',
              name: 'GPT',
              provider: 'openai',
              model_id: 'gpt-4.1',
              model_type: 'chat',
              status: 'active',
              config: { base_url: null, embedding_dim: null, max_tokens: 4096, rate_limit_rpm: null },
              visible_group_ids: [],
            },
          ],
          meta: { request_id: 'req-models' },
        }));
      }

      if (path.startsWith('/api/admin/audit-logs')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'audit-1',
              actor_user_id: 'user-admin',
              action: 'auth.login',
              resource_type: 'auth',
              resource_id: null,
              space_id: null,
              ip: null,
              user_agent: null,
              request_id: 'req-audit',
              metadata_json: {},
              created_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          meta: { request_id: 'req-audit-list' },
        }));
      }

      if (path.startsWith('/api/admin/system/health')) {
        return Promise.resolve(jsonResponse({
          data: {
            status: 'healthy',
            uptime: 120,
            components: {
              database: { status: 'healthy', latency_ms: 2 },
              redis: { status: 'healthy', latency_ms: 1 },
              minio: { status: 'not_configured' },
            },
          },
          meta: { request_id: 'req-health' },
        }));
      }

      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
    }),
  );
}

function mockChatSessionsApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (/^\/api\/spaces\/[^/]+\/chat\/sessions$/.test(path)) {
        return Promise.resolve(jsonResponse({
          data: [],
          meta: {
            request_id: 'req-chat-sessions',
            pagination: {
              page: 1,
              per_page: 50,
              total: 0,
              has_next: false,
            },
          },
        }));
      }

      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
    }),
  );
}

function mockOverviewApi() {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = getRequestPath(input);

    if (path === '/api/spaces/space-main') {
      return Promise.resolve(jsonResponse({
        data: {
          id: 'space-main',
          name: 'Main Space',
          slug: 'main-space',
          status: 'active',
          description: null,
          active_graphify_run_id: null,
          active_index_snapshot_id: null,
          index_consistency_status: 'consistent',
          strict_knowledge_only: true,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        meta: { request_id: 'req-space' },
      }));
    }

    if (path === '/api/spaces/space-main/stats') {
      return Promise.resolve(jsonResponse({
        data: {
          space_id: 'space-main',
          source_count: 0,
          page_count: 0,
          node_count: 0,
          edge_count: 0,
          index_consistency: 'consistent',
        },
        meta: { request_id: 'req-stats' },
      }));
    }

    if (path === '/api/spaces/space-main/uploads' || path === '/api/spaces/space-main/wiki/pages') {
      return Promise.resolve(jsonResponse({ data: [], meta: { request_id: 'req-list' } }));
    }

    if (path === '/api/graph/communities') {
      return Promise.resolve(jsonResponse({
        data: { communities: [] },
        meta: { request_id: 'req-communities' },
      }));
    }

    if (path === '/api/graphify/runs') {
      return Promise.resolve(jsonResponse({ data: [], meta: { request_id: 'req-runs' } }));
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
    return input.split('?')[0] ?? input;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return input.url.split('?')[0] ?? input.url;
}
