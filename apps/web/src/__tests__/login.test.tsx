// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { AuthProvider, type AuthUser } from '../lib/auth';
import Login from '../pages/Login';
import { ThemeProvider } from '../theme/ThemeProvider';

const LOGIN_USER: AuthUser = {
  id: 'user-login',
  email: 'login@example.com',
  name: 'Login User',
  role: 'viewer',
  groups: [],
  spaces: [{ id: 'space-main', name: 'Main Space', role: 'viewer' }],
};

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Login', () => {
  it('renders i18n text', () => {
    renderLogin();

    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
  });

  it('submits credentials and redirects to home', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const path = getRequestPath(input);

      if (path === '/api/auth/login') {
        return Promise.resolve(jsonResponse({
          data: {
            access_token: 'access-login',
            expires_in: 3600,
            user: LOGIN_USER,
          },
        }));
      }

      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({
          data: { ...LOGIN_USER, spaces: LOGIN_USER.spaces ?? [] },
        }));
      }

      return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'login@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('home-route')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('shows translated API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(jsonResponse({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }, 401)),
      ),
    );

    renderLogin();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'login@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'bad-password' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码不正确。');
  });
});

function renderLogin(): void {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <ThemeProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>home-route</div>} />
          </Routes>
        </ThemeProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
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
