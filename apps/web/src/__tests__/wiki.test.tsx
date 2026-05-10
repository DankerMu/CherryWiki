// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthUser } from '../lib/auth.js';
import type { WikiPage, WikiPageContent, WikiPageVersion } from '../lib/wikiApi.js';
import WikiPageDetail from '../pages/wiki/WikiPageDetail.js';
import WikiPageList from '../pages/wiki/WikiPageList.js';
import WikiVersionHistory from '../pages/wiki/WikiVersionHistory.js';
import { WikiStatusBadge } from '../pages/wiki/wikiUi.js';

type GetWrappedMock = (path: string, query?: Record<string, unknown>) => Promise<unknown>;
type PostMock = (path: string, body?: unknown) => Promise<unknown>;

const apiMocks = vi.hoisted(() => ({
  getWrapped: vi.fn<GetWrappedMock>(),
  post: vi.fn<PostMock>(),
}));

vi.mock('../components/TiptapRenderer', () => ({
  default: ({ markdown }: { markdown: string }) => <div data-testid="tiptap-renderer" dangerouslySetInnerHTML={{ __html: markdown
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- \[x\] (.+)$/gm, '<p>$1</p>')
    .replace(/\| ([^|]+) \| ([^|]+) \|/g, '<table><tbody><tr><td>$1</td><td>$2</td></tr></tbody></table>')
    .replace(/\| [-\s|]*/g, '')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="hljs">$2</code></pre>')
    .replace(/\n/g, '') }} />,
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
    configureApiClient: vi.fn(),
    api: {
      getWrapped: apiMocks.getWrapped,
      post: apiMocks.post,
      get: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WikiPageList', () => {
  it('renders page list with antd Table', async () => {
    apiMocks.getWrapped.mockResolvedValueOnce({
      data: [
        buildPage({ id: 'row-1', page_id: 'space-1.community.main', title: 'Community Overview', status: 'published' }),
      ],
      meta: { pagination: { page: 1, per_page: 20, total: 1, has_next: false } },
    });

    renderWithRouter(<WikiPageList spaceId="space-1" />);

    // antd Table shows data after loading
    expect(await screen.findByText('Community Overview')).toBeInTheDocument();
    expect(screen.getByText('space-1.community.main')).toBeInTheDocument();
    // antd Tag renders status
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('shows empty state when no pages exist', async () => {
    apiMocks.getWrapped.mockResolvedValueOnce({
      data: [],
      meta: { pagination: { page: 1, per_page: 20, total: 0, has_next: false } },
    });

    renderWithRouter(<WikiPageList spaceId="space-1" />);

    expect(await screen.findByText('No wiki pages in this space yet.')).toBeInTheDocument();
  });
});

describe('WikiPageDetail', () => {
  it('renders markdown content', async () => {
    apiMocks.getWrapped.mockImplementation((path: string) => {
      if (path.endsWith('/content')) {
        return Promise.resolve({
          data: buildContent({
            title: 'Cherry Knowledge',
            content_markdown: [
              '# Markdown Title',
              '',
              '- [x] Parsed source',
              '',
              '| Field | Value |',
              '| --- | --- |',
              '| Status | Ready |',
              '',
              '```ts',
              'const wiki = true;',
              '```',
            ].join('\n'),
          }),
        });
      }

      return Promise.resolve({ data: buildPage({ title: 'Cherry Knowledge', status: 'published' }) });
    });

    renderWithRouter(<WikiPageDetail spaceId="space-1" pageId="page-1" />);

    expect(await screen.findByRole('heading', { name: 'Markdown Title' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Parsed source')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Ready' })).toBeInTheDocument();
    expect(document.querySelector('code.hljs')).toHaveTextContent('const wiki = true;');
  });
});

describe('WikiVersionHistory', () => {
  it('renders version list with antd Table', async () => {
    apiMocks.getWrapped.mockImplementation((path: string) => {
      if (path.endsWith('/versions')) {
        return Promise.resolve({
          data: [
            buildVersion({ version_id: 'version-2', source_run_id: 'graphify', status: 'current' }),
            buildVersion({ version_id: 'version-1', source_run_id: null, status: 'archived' }),
          ],
          meta: { pagination: { page: 1, per_page: 20, total: 2, has_next: false } },
        });
      }

      return Promise.resolve({ data: buildPage({ current_version_id: 'version-2', title: 'Versioned Page' }) });
    });

    renderWithRouter(<WikiVersionHistory spaceId="space-1" pageId="page-1" />);

    expect(await screen.findByText('version-2')).toBeInTheDocument();
    expect(screen.getByText('version-1')).toBeInTheDocument();
    // Rollback button for non-current version
    expect(screen.getByRole('button', { name: 'Rollback' })).toBeInTheDocument();
  });
});

describe('WikiStatusBadge', () => {
  it('renders status badges as antd Tags', () => {
    render(
      <>
        <WikiStatusBadge status="draft" />
        <WikiStatusBadge status="published" />
        <WikiStatusBadge status="archived" />
      </>,
    );

    // antd Tag renders the status text
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });
});

const testUser: AuthUser = {
  id: 'test-user',
  email: 'test@test.local',
  name: 'Test',
  role: 'admin',
  groups: [],
  spaces: [{ id: 'space-1', name: 'Test Space', role: 'admin' }],
};

function renderWithRouter(element: ReactElement): void {
  render(
    <MemoryRouter>
      <AuthProvider initialSession={{ user: testUser, accessToken: 'test-token' }}>{element}</AuthProvider>
    </MemoryRouter>,
  );
}

function buildPage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'page-row-id',
    page_id: 'page-1',
    space_id: 'space-1',
    title: 'Wiki Page',
    slug: 'wiki-page',
    status: 'draft',
    current_version_id: 'version-2',
    indexed_version_id: 'version-1',
    sync_status: 'synced',
    created_by: 'author-1',
    updated_at: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

function buildContent(overrides: Partial<WikiPageContent> = {}): WikiPageContent {
  return {
    page_id: 'page-1',
    version_id: 'version-2',
    title: 'Wiki Page',
    content_markdown: '# Wiki Page',
    ...overrides,
  };
}

function buildVersion(overrides: Partial<WikiPageVersion> = {}): WikiPageVersion {
  return {
    version_id: 'version-1',
    content_hash: 'sha256:version-1',
    author: 'author-1',
    source_run_id: null,
    status: 'archived',
    created_at: '2026-05-01T09:00:00.000Z',
    ...overrides,
  };
}
