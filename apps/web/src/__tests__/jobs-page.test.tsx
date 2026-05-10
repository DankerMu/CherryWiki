// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { AuthProvider, type AuthUser } from '../lib/auth';
import JobDetailPage from '../pages/admin/JobDetailPage';
import JobsPage from '../pages/admin/JobsPage';

const ADMIN_USER: AuthUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  groups: [],
  spaces: [{ id: 'space-main', name: 'Main Space', role: 'admin' }],
};

type JobStub = {
  job_id: string;
  type: string;
  display_name: string | null;
  status: string;
  space_id: string;
  progress: {
    percent: number;
    stage: string;
  };
  created_by: string;
  payload_json: {
    source_id: string;
  };
  result_json: null;
  error_json: null;
  cancel_requested_at: string | null;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  started_at: string;
  completed_at: string | null;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('JobsPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('renders the jobs table and filters', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs');

    expect(await screen.findByRole('heading', { name: '任务中心' })).toBeInTheDocument();
    expect(await screen.findByText('readme.md')).toBeInTheDocument();
    expect(await screen.findByText('Graphify · job-1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('shows display_name as primary label when available', async () => {
    stubJobApi();

    renderJobsRoute('/admin/jobs');

    expect(await screen.findByText('readme.md')).toBeInTheDocument();
    expect(screen.getByText('Graphify · job-1')).toBeInTheDocument();
  });

  it('falls back to type label when display_name is null', async () => {
    stubJobApi({ job: { display_name: null } });

    renderJobsRoute('/admin/jobs');

    expect(await screen.findByText('Graphify')).toBeInTheDocument();
    expect(screen.getByText('job-1')).toBeInTheDocument();
  });

  it('fetches the jobs list from /api/admin/jobs', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs');

    await waitFor(() => {
      expect(getRequestUrls(fetchMock)).toContain('/api/admin/jobs?page=1&per_page=20&sort=-created_at');
    });
  });

  it('loads space options in the dropdown', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs');

    await waitFor(() => {
      expect(getRequestUrls(fetchMock)).toContain('/api/spaces?per_page=100&sort=name');
    });
    await openSpaceSelect();

    expect(await screen.findByText('Main Space')).toBeInTheDocument();
  });

  it('stops showing the space filter loading indicator when the spaces list is empty', async () => {
    const fetchMock = stubJobApi({ spaces: [] });

    renderJobsRoute('/admin/jobs');

    await waitFor(() => {
      expect(getRequestUrls(fetchMock)).toContain('/api/spaces?per_page=100&sort=name');
    });

    await waitFor(() => {
      expect(getSpaceSelectContainer().querySelector('.anticon-loading')).not.toBeInTheDocument();
    });
  });

  it('selecting a space filters jobs', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs');

    await selectSpaceOption('Main Space');

    await waitFor(() => {
      expect(getAdminJobRequestUrls(fetchMock).some((url) => getQueryParam(url, 'space_id') === 'space-main')).toBe(true);
    });
  });

  it('clearing a space removes the filter', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs');

    await selectSpaceOption('Main Space');

    await waitFor(() => {
      expect(getAdminJobRequestUrls(fetchMock).some((url) => getQueryParam(url, 'space_id') === 'space-main')).toBe(true);
    });

    const requestCountAfterSelect = getAdminJobRequestUrls(fetchMock).length;
    const clearButton = getSpaceSelectContainer().querySelector<HTMLElement>('.ant-select-clear');
    expect(clearButton).not.toBeNull();
    fireEvent.mouseDown(clearButton!);
    fireEvent.click(clearButton!);

    await waitFor(() => {
      expect(
        getAdminJobRequestUrls(fetchMock)
          .slice(requestCountAfterSelect)
          .some((url) => !getQueryParams(url).has('space_id')),
      ).toBe(true);
    });
  });

  it('keeps the jobs table usable when space options fail to load', async () => {
    const fetchMock = stubJobApi({ failSpaces: true });

    renderJobsRoute('/admin/jobs');

    expect(await screen.findByText('readme.md')).toBeInTheDocument();

    await waitFor(() => {
      expect(getSpaceSelectContainer()).toHaveClass('ant-select-status-error');
      expect(getAdminJobRequestUrls(fetchMock).length).toBeGreaterThan(0);
    });
  });
});

describe('JobDetailPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('renders job details and the event timeline', async () => {
    stubJobApi({ job: { display_name: 'readme.md' } });

    renderJobsRoute('/admin/jobs/job-1');

    expect(await screen.findByRole('heading', { name: '任务详情' })).toBeInTheDocument();
    expect(await screen.findByText('readme.md')).toBeInTheDocument();
    expect(await screen.findByText('space-main')).toBeInTheDocument();
    expect(screen.getAllByText('Graphify').length).toBeGreaterThan(0);
    expect(screen.getByText('Progress Updated')).toBeInTheDocument();
  });

  it('calls POST /api/jobs/:id/cancel when the cancel button is pressed', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs/job-1');

    await screen.findByText('space-main');

    // The cancel button is wrapped in a Popconfirm, so we first click the button
    const cancelBtn = await screen.findByRole('button', { name: '取消任务' });
    fireEvent.click(cancelBtn);

    // Then confirm the Popconfirm — antd renders the OK button inside a popover
    await waitFor(() => {
      const popoverButtons = document.querySelectorAll('.ant-popconfirm .ant-btn-primary');
      expect(popoverButtons.length).toBeGreaterThan(0);
      fireEvent.click(popoverButtons[0] as HTMLElement);
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => getRequestPath(input) === '/api/jobs/job-1/cancel' && init?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});

function renderJobsRoute(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider initialSession={{ user: ADMIN_USER, accessToken: 'test-token' }}>
        <Routes>
          <Route path="/admin/jobs" element={<JobsPage />} />
          <Route path="/admin/jobs/:jobId" element={<JobDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function stubJobApi(
  options: {
    failSpaces?: boolean;
    spaces?: { id: string; name: string }[];
    job?: Partial<JobStub>;
  } = {},
) {
  let cancelRequestedAt: string | null = null;
  const spaces = options.spaces ?? [{ id: 'space-main', name: 'Main Space' }];

  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const path = getRequestPath(input);

    if (path === '/api/spaces') {
      if (options.failSpaces === true) {
        return Promise.resolve(jsonResponse({ error: { code: 'SPACES_UNAVAILABLE', message: 'Spaces unavailable' } }, 500));
      }

      return Promise.resolve(
        jsonResponse({
          data: spaces,
          meta: {
            pagination: {
              page: 1,
              per_page: 100,
              total: spaces.length,
              has_next: false,
            },
          },
        }),
      );
    }

    if (path === '/api/admin/jobs') {
      return Promise.resolve(
        jsonResponse({
          data: [buildJob(cancelRequestedAt, options.job)],
          meta: {
            request_id: 'req-admin-jobs',
            pagination: {
              page: 1,
              per_page: 20,
              total: 1,
              has_next: false,
            },
          },
        }),
      );
    }

    if (path === '/api/jobs/job-1' && init?.method !== 'POST') {
      return Promise.resolve(
        jsonResponse({
          data: buildJob(cancelRequestedAt, options.job),
          meta: { request_id: 'req-job-detail' },
        }),
      );
    }

    if (path === '/api/jobs/job-1/events') {
      return Promise.resolve(
        jsonResponse({
          data: [
            {
              event: 'status_changed',
              timestamp: '2026-04-29T10:00:00.000Z',
              detail: {
                from: 'pending',
                to: 'running',
              },
            },
            {
              event: 'progress_updated',
              timestamp: '2026-04-29T10:02:00.000Z',
              detail: {
                percent: 65,
                stage: 'chunking',
              },
            },
          ],
          meta: { request_id: 'req-job-events' },
        }),
      );
    }

    if (path === '/api/jobs/job-1/cancel' && init?.method === 'POST') {
      cancelRequestedAt = '2026-04-29T10:03:00.000Z';

      return Promise.resolve(
        jsonResponse({
          data: {
            job_id: 'job-1',
            status: 'running',
            cancel_requested_at: cancelRequestedAt,
          },
          meta: { request_id: 'req-job-cancel' },
        }),
      );
    }

    return Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openSpaceSelect(): Promise<void> {
  const combobox = await findSpaceCombobox();
  fireEvent.mouseDown(combobox);
}

async function selectSpaceOption(name: string): Promise<void> {
  await openSpaceSelect();
  fireEvent.click(await screen.findByText(name));
}

function getSpaceSelectContainer(): HTMLElement {
  const combobox = getSpaceCombobox();
  const container = combobox.closest('.ant-select');
  if (container === null) {
    throw new Error('Space Select container was not found');
  }
  return container as HTMLElement;
}

async function findSpaceCombobox(): Promise<HTMLElement> {
  const labelledElements = await screen.findAllByLabelText('空间');
  const combobox = labelledElements.find((element) => element.getAttribute('role') === 'combobox');
  if (combobox === undefined) {
    throw new Error('Space Select combobox was not found');
  }
  return combobox;
}

function getSpaceCombobox(): HTMLElement {
  const combobox = screen
    .getAllByLabelText('空间')
    .find((element) => element.getAttribute('role') === 'combobox');
  if (combobox === undefined) {
    throw new Error('Space Select combobox was not found');
  }
  return combobox;
}

function buildJob(cancelRequestedAt: string | null = null, overrides: Partial<JobStub> = {}): JobStub {
  return {
    job_id: 'job-1',
    type: 'graphify',
    display_name: 'readme.md',
    status: 'running',
    space_id: 'space-main',
    progress: {
      percent: 65,
      stage: 'chunking',
    },
    created_by: 'user-admin',
    payload_json: {
      source_id: 'source-1',
    },
    result_json: null,
    error_json: null,
    cancel_requested_at: cancelRequestedAt,
    attempt_count: 1,
    max_attempts: 3,
    created_at: '2026-04-29T10:00:00.000Z',
    started_at: '2026-04-29T10:01:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequestPath(input: RequestInfo | URL): string {
  return getRequestUrl(input).split('?')[0] ?? '';
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function getRequestUrls(fetchMock: ReturnType<typeof stubJobApi>): string[] {
  return fetchMock.mock.calls.map(([input]) => getRequestUrl(input));
}

function getAdminJobRequestUrls(fetchMock: ReturnType<typeof stubJobApi>): string[] {
  return getRequestUrls(fetchMock).filter((url) => getRequestPath(url) === '/api/admin/jobs');
}

function getQueryParam(url: string, key: string): string | null {
  return getQueryParams(url).get(key);
}

function getQueryParams(url: string): URLSearchParams {
  return new URLSearchParams(url.split('?')[1] ?? '');
}
