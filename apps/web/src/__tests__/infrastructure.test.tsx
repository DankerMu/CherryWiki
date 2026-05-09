// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { AuthProvider, type AuthUser } from '../lib/auth';
import AppShell from '../components/AppShell';

const ADMIN_USER: AuthUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  groups: [],
  spaces: [{ id: 'space-1', name: 'Space One', role: 'admin' }],
};

const VIEWER_USER: AuthUser = {
  id: 'user-viewer',
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'viewer',
  groups: [],
  spaces: [{ id: 'space-1', name: 'Space One', role: 'viewer' }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    // Ignore
  }
});

describe('ThemeProvider', () => {
  it('renders children with antd ConfigProvider', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ThemeProvider>
            <div data-testid="child">Hello</div>
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('provides theme mode via useTheme hook', () => {
    function ThemeConsumer() {
      const { themeMode } = useTheme();
      return <span data-testid="mode">{themeMode}</span>;
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <ThemeProvider>
            <ThemeConsumer />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const modeEl = screen.getByTestId('mode');
    expect(modeEl.textContent === 'light' || modeEl.textContent === 'dark').toBe(true);
  });

  it('toggles theme mode', () => {
    function ThemeToggler() {
      const { themeMode, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="mode">{themeMode}</span>
          <button type="button" onClick={toggleTheme}>Toggle</button>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <ThemeProvider>
            <ThemeToggler />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const initial = screen.getByTestId('mode').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    const after = screen.getByTestId('mode').textContent;
    expect(initial).not.toBe(after);
  });

  it('persists theme to localStorage', () => {
    function ThemeToggler() {
      const { themeMode, setThemeMode } = useTheme();
      return (
        <div>
          <span data-testid="mode">{themeMode}</span>
          <button type="button" onClick={() => setThemeMode('dark')}>Set Dark</button>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <AuthProvider>
          <ThemeProvider>
            <ThemeToggler />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set Dark' }));
    expect(localStorage.getItem('cherrywiki.theme')).toBe('dark');
  });

  it('survives localStorage being disabled', () => {
    // Simulate localStorage throwing
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    function ThemeConsumer() {
      const { themeMode } = useTheme();
      return <span data-testid="mode">{themeMode}</span>;
    }

    // Should not throw
    expect(() => {
      render(
        <MemoryRouter>
          <AuthProvider>
            <ThemeProvider>
              <ThemeConsumer />
            </ThemeProvider>
          </AuthProvider>
        </MemoryRouter>,
      );
    }).not.toThrow();

    expect(screen.getByTestId('mode')).toBeInTheDocument();
  });
});

describe('i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('initializes with zh-CN as fallback', () => {
    expect(i18n.language).toBe('zh-CN');
  });

  it('resolves Chinese keys', () => {
    expect(i18n.t('login.page.title')).toBe('登录');
    expect(i18n.t('shell.sidebar.chat')).toBe('聊天');
    expect(i18n.t('common.action.save')).toBe('保存');
  });

  it('resolves English keys after language change', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('login.page.title')).toBe('Login');
    expect(i18n.t('shell.sidebar.chat')).toBe('Chat');
    expect(i18n.t('common.action.save')).toBe('Save');
  });

  it('has matching keys in both language files', () => {
    const zhKeys = Object.keys(i18n.getResourceBundle('zh-CN', 'translation') as Record<string, unknown>);
    const enKeys = Object.keys(i18n.getResourceBundle('en', 'translation') as Record<string, unknown>);
    expect(zhKeys.sort()).toEqual(enKeys.sort());
  });
});

describe('AppShell', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders sidebar with app name', () => {
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('CherryWiki')).toBeInTheDocument();
  });

  it('shows admin menu items for admin users', () => {
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
  });

  it('hides admin menu items for non-admin users', () => {
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <AuthProvider initialSession={{ user: VIEWER_USER, accessToken: 'test-token' }}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('menuitem', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('renders space function menu items', () => {
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <AuthProvider initialSession={{ user: VIEWER_USER, accessToken: 'test-token' }}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getAllByText('Chat').length).toBeGreaterThan(0);
    expect(screen.getByText('Wiki')).toBeInTheDocument();
    expect(screen.getByText('Uploads')).toBeInTheDocument();
  });

  it.each([
    ['Chat', 'Chat Harness'],
    ['Wiki', 'Wiki Harness'],
  ])('navigates to %s from an admin route', async (menuLabel, targetHeading) => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
          <ThemeProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/admin/users" element={<h1>Users Harness</h1>} />
                <Route path="/spaces/:spaceId/chat" element={<h1>Chat Harness</h1>} />
                <Route path="/spaces/:spaceId/wiki" element={<h1>Wiki Harness</h1>} />
              </Route>
            </Routes>
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Space Functions')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Users Harness' })).toBeInTheDocument();

    const menuItem = screen.getByText(menuLabel).closest('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    fireEvent.click(menuItem!);

    expect(await screen.findByRole('heading', { name: targetHeading })).toBeInTheDocument();
  });

  it('shows user name in header', () => {
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    // User name should appear in header or sidebar
    expect(screen.getAllByText('Admin User').length).toBeGreaterThan(0);
  });

  it('renders breadcrumb', () => {
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/chat']}>
        <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    // Space name appears in breadcrumb and/or selector
    expect(screen.getAllByText('Space One').length).toBeGreaterThan(0);
  });
});
