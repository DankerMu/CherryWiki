import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProgressBar from '../components/ProgressBar';
import JobDetailPage from '../pages/admin/JobDetailPage';
import JobsPage from '../pages/admin/JobsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('JobsPage', () => {
  it('renders the jobs table and filters', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs');

    expect(await screen.findByRole('heading', { name: 'Task Center' })).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Page')).toBeInTheDocument();
    expect(screen.getByLabelText('Per page')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Progress' })).toBeInTheDocument();
    expect(await screen.findByText('job-1')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('fetches the jobs list from /api/admin/jobs', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(getRequestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toContain(
        '/api/admin/jobs?page=1&per_page=20&sort=-created_at',
      );
    });
  });
});

describe('JobDetailPage', () => {
  it('renders job details and the event timeline', async () => {
    stubJobApi();

    renderJobsRoute('/admin/jobs/job-1');

    expect(await screen.findByRole('heading', { name: 'Job Detail' })).toBeInTheDocument();
    expect(screen.getAllByText('Graphify').length).toBeGreaterThan(0);
    expect(screen.getByText('space-main')).toBeInTheDocument();
    expect(screen.getByText('Progress Updated')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'chunking progress' })).toHaveAttribute('aria-valuenow', '65');
  });

  it('calls POST /api/jobs/:id/cancel when the cancel button is pressed', async () => {
    const fetchMock = stubJobApi();

    renderJobsRoute('/admin/jobs/job-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Job' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => getRequestPath(input) === '/api/jobs/job-1/cancel' && init?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});

describe('ProgressBar', () => {
  it('renders progress text, stage, and aria state', () => {
    render(<ProgressBar percent={65} stage="chunking" size="md" />);

    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('chunking')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'chunking progress' })).toHaveAttribute('aria-valuenow', '65');
  });
});

function renderJobsRoute(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/jobs" element={<JobsPage />} />
        <Route path="/admin/jobs/:jobId" element={<JobDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function stubJobApi() {
  let cancelRequestedAt: string | null = null;

  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const path = getRequestPath(input);

    if (path === '/api/admin/jobs') {
      return Promise.resolve(
        jsonResponse({
          data: [buildJob(cancelRequestedAt)],
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
          data: buildJob(cancelRequestedAt),
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

function buildJob(cancelRequestedAt: string | null = null) {
  return {
    job_id: 'job-1',
    type: 'graphify',
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
