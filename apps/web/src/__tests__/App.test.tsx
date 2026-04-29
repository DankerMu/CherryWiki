import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';

function renderRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('App routing', () => {
  it('renders Home for /', () => {
    renderRoute('/');

    expect(screen.getByRole('heading', { name: 'CherryGraph Studio' })).toBeInTheDocument();
  });

  it('renders Login for /login', () => {
    renderRoute('/login');

    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
  });

  it('renders Chat for /chat', () => {
    renderRoute('/chat');

    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });

  it('renders Wiki for /wiki/test-space', () => {
    renderRoute('/wiki/test-space');

    expect(screen.getByRole('heading', { name: 'Wiki' })).toBeInTheDocument();
  });

  it('renders Admin for /admin', () => {
    renderRoute('/admin');

    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
  });

  it('renders Chat for /chat/:id', () => {
    renderRoute('/chat/conv-123');

    expect(screen.queryAllByRole('heading', { name: 'Chat' }).length).toBeGreaterThan(0);
  });

  it('renders Wiki for /wiki/:spaceId/:pageId', () => {
    renderRoute('/wiki/test-space/page-456');

    expect(screen.queryAllByRole('heading', { name: 'Wiki' }).length).toBeGreaterThan(0);
  });

  it('renders Admin for /admin/users', () => {
    renderRoute('/admin/users');

    expect(screen.queryAllByRole('heading', { name: 'Admin' }).length).toBeGreaterThan(0);
  });

  it('renders Admin for /admin/models', () => {
    renderRoute('/admin/models');

    expect(screen.queryAllByRole('heading', { name: 'Admin' }).length).toBeGreaterThan(0);
  });

  it('renders NotFound for /nonexistent', () => {
    renderRoute('/nonexistent');

    expect(screen.getByRole('heading', { name: '404 — Page Not Found' })).toBeInTheDocument();
  });
});
