// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { ProtectedShell } from '../App';
import { AuthProvider, type AuthUser, useAuth } from '../lib/auth';
import Login from '../pages/Login';
import { ThemeProvider } from '../theme/ThemeProvider';

const BOOTSTRAP_USER: AuthUser = {
  id: 'user-bootstrap',
  email: 'bootstrap@example.com',
  name: 'Bootstrap User',
  role: 'admin',
  groups: [],
  spaces: [{ id: 'space-main', name: 'Main Space', role: 'admin' }],
};

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('auth bootstrap session persistence', () => {
  it('restores a valid cookie session and renders protected content instead of login', async () => {
    const fetchMock = stubBootstrapApi();

    renderApp('/');

    expect(await screen.findByText('protected-home')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '登录' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers) as Headers,
      }),
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer access-bootstrap');
  });

  it('redirects to /login after bootstrap when no refresh cookie exists', async () => {
    stubBootstrapRefreshFailure('NO_REFRESH_TOKEN');

    renderApp('/spaces/space-main/protected');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByText('protected-space')).not.toBeInTheDocument();
  });

  it('redirects to /login after bootstrap when the refresh token is revoked', async () => {
    stubBootstrapRefreshFailure('REFRESH_TOKEN_REVOKED');

    renderApp('/spaces/space-main/protected');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByText('protected-space')).not.toBeInTheDocument();
  });

  it('shows loading and does not render the login page while refresh is delayed', async () => {
    const refreshRequest = createDeferred<Response>();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/refresh') {
        return refreshRequest.promise;
      }

      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ data: BOOTSTRAP_USER }));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/spaces/space-main/protected');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.objectContaining({ method: 'POST' })));
    expect(document.querySelector('.ant-spin')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '登录' })).not.toBeInTheDocument();
    expect(screen.queryByText('protected-space')).not.toBeInTheDocument();

    refreshRequest.resolve(jsonResponse({ data: { access_token: 'access-bootstrap', expires_in: 3600 } }));

    expect(await screen.findByText('protected-space')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '登录' })).not.toBeInTheDocument();
  });

  it('keeps the login flow working after a fresh visitor bootstrap refresh fails', { timeout: 15000 }, async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/refresh') {
        return Promise.resolve(unauthorizedResponse('NO_REFRESH_TOKEN'));
      }

      if (path === '/api/auth/login') {
        return Promise.resolve(jsonResponse({
          data: {
            access_token: 'access-login',
            expires_in: 3600,
            user: BOOTSTRAP_USER,
          },
        }));
      }

      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ data: BOOTSTRAP_USER }));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'bootstrap@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('protected-home', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('does not let a delayed login-page bootstrap overwrite a submitted login session', async () => {
    const refreshRequest = createDeferred<Response>();
    const seenAuthHeaders: Array<string | null> = [];
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/refresh') {
        return refreshRequest.promise;
      }

      if (path === '/api/auth/login') {
        return Promise.resolve(jsonResponse({
          data: {
            access_token: 'access-login',
            expires_in: 3600,
            user: BOOTSTRAP_USER,
          },
        }));
      }

      if (path === '/api/auth/me') {
        seenAuthHeaders.push(new Headers(init?.headers).get('Authorization'));
        return Promise.resolve(jsonResponse({ data: BOOTSTRAP_USER }));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'bootstrap@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('protected-home')).toBeInTheDocument();
    refreshRequest.resolve(jsonResponse({ data: { access_token: 'access-bootstrap', expires_in: 3600 } }));

    await waitFor(() => expect(document.querySelector('.ant-spin')).not.toBeInTheDocument());
    expect(seenAuthHeaders).toEqual(['Bearer access-login']);
  });

  it('delayed bootstrap refresh 401 does not clear a login session established during bootstrap', async () => {
    const refreshRequest = createDeferred<Response>();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/refresh') {
        return refreshRequest.promise;
      }

      if (path === '/api/auth/login') {
        return Promise.resolve(jsonResponse({
          data: {
            access_token: 'access-login',
            expires_in: 3600,
            user: BOOTSTRAP_USER,
          },
        }));
      }

      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ data: BOOTSTRAP_USER }));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'bootstrap@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('protected-home')).toBeInTheDocument();
    refreshRequest.resolve(unauthorizedResponse('NO_REFRESH_TOKEN'));
    await waitForMicrotasks();

    expect(screen.getByText('protected-home')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '登录' })).not.toBeInTheDocument();
  });

  it('delayed bootstrap does not resurrect a logged-out session', async () => {
    const refreshRequest = createDeferred<Response>();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/refresh') {
        return refreshRequest.promise;
      }

      if (path === '/api/auth/login') {
        return Promise.resolve(jsonResponse({
          data: {
            access_token: 'access-login',
            expires_in: 3600,
            user: BOOTSTRAP_USER,
          },
        }));
      }

      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ data: BOOTSTRAP_USER }));
      }

      if (path === '/api/auth/logout') {
        return Promise.resolve(jsonResponse({ data: { success: true } }));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'bootstrap@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('protected-home')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'logout-test' }));
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();

    refreshRequest.resolve(jsonResponse({ data: { access_token: 'access-bootstrap', expires_in: 3600 } }));
    await waitForMicrotasks();

    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByText('protected-home')).not.toBeInTheDocument();
  });

  it('does not authenticate login when /auth/me returns 401 during delayed bootstrap', async () => {
    const refreshRequest = createDeferred<Response>();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/refresh') {
        return refreshRequest.promise;
      }

      if (path === '/api/auth/login') {
        return Promise.resolve(jsonResponse({
          data: {
            access_token: 'access-login',
            expires_in: 3600,
            user: BOOTSTRAP_USER,
          },
        }));
      }

      if (path === '/api/auth/me') {
        return Promise.resolve(unauthorizedResponse('TOKEN_INVALID'));
      }

      return Promise.resolve(notFoundResponse());
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp('/login');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'bootstrap@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized');
    expect(screen.queryByText('protected-home')).not.toBeInTheDocument();

    refreshRequest.resolve(jsonResponse({ data: { access_token: 'access-bootstrap', expires_in: 3600 } }));
    await waitFor(() => expect(document.querySelector('.ant-spin')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
  });

  it('deduplicates bootstrap refresh under StrictMode effect replay', async () => {
    const fetchMock = stubBootstrapApi();

    renderApp('/', { strictMode: true });

    expect(await screen.findByText('protected-home')).toBeInTheDocument();
    const refreshCalls = fetchMock.mock.calls.filter((call) => getRequestPath(call[0]) === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('does not stay bootstrapping when /auth/me fails after a successful refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input) => {
        const path = getRequestPath(input);

        if (path === '/api/auth/refresh') {
          return Promise.resolve(jsonResponse({ data: { access_token: 'access-bootstrap', expires_in: 3600 } }));
        }

        if (path === '/api/auth/me') {
          return Promise.resolve(jsonResponse({ error: { code: 'API_ERROR', message: 'Profile unavailable' } }, 500));
        }

        return Promise.resolve(notFoundResponse());
      }),
    );

    renderApp('/spaces/space-main/protected');

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(document.querySelector('.ant-spin')).not.toBeInTheDocument();
    expect(screen.queryByText('protected-space')).not.toBeInTheDocument();
  });
});

function renderApp(path: string, options: { strictMode?: boolean } = {}): void {
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ThemeProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedShell />}>
              <Route path="/" element={<ProtectedHome />} />
              <Route path="/spaces/:spaceId/protected" element={<div>protected-space</div>} />
            </Route>
          </Routes>
        </ThemeProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  render(
    options.strictMode === true ? (
      <StrictMode>{tree}</StrictMode>
    ) : (
      tree
    ),
  );
}

function ProtectedHome() {
  const { logout } = useAuth();

  return (
    <div>
      <div>protected-home</div>
      <button type="button" onClick={() => void logout()}>
        logout-test
      </button>
    </div>
  );
}

function stubBootstrapApi(): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchMock = vi.fn<typeof fetch>((input) => {
    const path = getRequestPath(input);

    if (path === '/api/auth/refresh') {
      return Promise.resolve(jsonResponse({ data: { access_token: 'access-bootstrap', expires_in: 3600 } }));
    }

    if (path === '/api/auth/me') {
      return Promise.resolve(jsonResponse({ data: BOOTSTRAP_USER }));
    }

    return Promise.resolve(notFoundResponse());
  });
  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

function stubBootstrapRefreshFailure(code: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input) => {
      if (getRequestPath(input) === '/api/auth/refresh') {
        return Promise.resolve(unauthorizedResponse(code));
      }

      return Promise.resolve(notFoundResponse());
    }),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function unauthorizedResponse(code: string): Response {
  return jsonResponse({ error: { code, message: 'Unauthorized' } }, 401);
}

function notFoundResponse(): Response {
  return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
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

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
