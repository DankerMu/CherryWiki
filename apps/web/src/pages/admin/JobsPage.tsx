import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import ProgressBar from '../../components/ProgressBar';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  formatDate,
  formatLabel,
  getErrorMessage,
} from '../../components/adminUi';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { type ApiMeta, api } from '../../lib/api';
import {
  ADMIN_JOB_STATUS_OPTIONS,
  ADMIN_JOB_TYPE_FILTER_OPTIONS,
  type AdminJob,
  getDisplayStatus,
} from '../../lib/adminTypes';

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: 20,
  total: 0,
  has_next: false,
};

const JOB_POLL_INTERVAL_MS = 5_000;
const PER_PAGE_OPTIONS = [10, 20, 50, 100];

function JobsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const deferredSpaceId = useDeferredValue(spaceId);
  const [page, setPage] = useState(DEFAULT_PAGINATION.page);
  const [perPage, setPerPage] = useState(DEFAULT_PAGINATION.per_page);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(
    async (background = false) => {
      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await api.getWrapped<AdminJob[]>('/admin/jobs', {
          type,
          status,
          space_id: deferredSpaceId,
          page,
          per_page: perPage,
          sort: '-created_at',
        });
        setJobs(response.data);
        setPagination(
          response.meta?.pagination ?? {
            page,
            per_page: perPage,
            total: response.data.length,
            has_next: false,
          },
        );
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        if (!background) {
          setIsLoading(false);
        }
      }
    },
    [deferredSpaceId, page, perPage, status, type],
  );

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const shouldPoll = status === 'running' || jobs.some((job) => job.status === 'running');

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadJobs(true);
    }, JOB_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadJobs, shouldPoll]);

  const totalPages = useMemo(() => {
    const computedPages = Math.ceil(pagination.total / Math.max(1, pagination.per_page));
    return Math.max(page, computedPages, 1);
  }, [page, pagination.per_page, pagination.total]);

  return (
    <>
      <PageHeader
        title="Task Center"
        description="Track ingestion, graph, and maintenance jobs across spaces."
        actions={
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              void loadJobs();
            }}
          >
            Refresh
          </button>
        }
      />

      <ErrorBanner error={error} />

      <section className="toolbar" aria-label="Job filters">
        <label>
          Type
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {ADMIN_JOB_TYPE_FILTER_OPTIONS.map((jobType) => (
              <option key={jobType} value={jobType}>
                {formatLabel(jobType)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {ADMIN_JOB_STATUS_OPTIONS.map((jobStatus) => (
              <option key={jobStatus} value={jobStatus}>
                {formatLabel(jobStatus)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Space
          <input
            type="search"
            value={spaceId}
            onChange={(event) => {
              setSpaceId(event.target.value);
              setPage(1);
            }}
            placeholder="Space ID"
          />
        </label>
        <label>
          Page
          <select value={page} onChange={(event) => setPage(Number(event.target.value))}>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageValue) => (
              <option key={pageValue} value={pageValue}>
                Page {pageValue}
              </option>
            ))}
          </select>
        </label>
        <label>
          Per page
          <select
            value={perPage}
            onChange={(event) => {
              setPerPage(Number(event.target.value));
              setPage(1);
            }}
          >
            {PER_PAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </section>

      {isLoading ? (
        <LoadingState label="Loading jobs..." />
      ) : jobs.length === 0 ? (
        <EmptyState label="No jobs match the current filters." />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Space</th>
                  <th>Progress</th>
                  <th>Created</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.job_id}
                    className="interactive-row"
                    role="link"
                    tabIndex={0}
                    onClick={() => {
                      void navigate(`/admin/jobs/${job.job_id}`);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void navigate(`/admin/jobs/${job.job_id}`);
                      }
                    }}
                  >
                    <td>
                      <strong>{formatLabel(job.type)}</strong>
                      <span className="subtle-id">{job.job_id}</span>
                    </td>
                    <td>
                      <StatusBadge status={getDisplayStatus(job)} />
                    </td>
                    <td>{job.space_id ?? 'Global'}</td>
                    <td className="progress-cell">{renderProgressCell(job)}</td>
                    <td>{formatDate(job.created_at)}</td>
                    <td>{formatJobDuration(job)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <span className="pagination-summary">
              Showing {getFirstItemIndex(pagination)}-{getLastItemIndex(pagination, jobs.length)} of {pagination.total}
            </span>
            <span className="pagination-summary">
              Page {pagination.page} of {totalPages}
            </span>
          </div>
        </>
      )}
    </>
  );
}

export default requireAdminPage(JobsPage);

function renderProgressCell(job: AdminJob) {
  if (job.progress !== null || job.status === 'running' || job.status === 'succeeded') {
    return (
      <ProgressBar
        percent={job.progress?.percent ?? (job.status === 'succeeded' ? 100 : 0)}
        stage={job.progress?.stage ?? getFallbackProgressStage(job.status)}
        size="sm"
      />
    );
  }

  return <span className="muted-copy">{formatLabel(job.status)}</span>;
}

function getFallbackProgressStage(status: string): string {
  if (status === 'running') {
    return 'Running';
  }

  if (status === 'succeeded') {
    return 'Completed';
  }

  return formatLabel(status);
}

function formatJobDuration(job: AdminJob): string {
  if (job.started_at === null) {
    return job.status === 'pending' ? 'Queued' : 'Not started';
  }

  const startedAt = parseTimestamp(job.started_at);
  if (startedAt === null) {
    return 'Unavailable';
  }

  const completedAt =
    job.completed_at !== null ? parseTimestamp(job.completed_at) : job.status === 'running' ? Date.now() : null;

  if (completedAt === null) {
    return 'In progress';
  }

  return formatElapsedTime(completedAt - startedAt);
}

function parseTimestamp(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatElapsedTime(durationMs: number): string {
  if (durationMs < 1_000) {
    return '<1s';
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getFirstItemIndex(pagination: NonNullable<ApiMeta['pagination']>): number {
  if (pagination.total === 0) {
    return 0;
  }

  return (pagination.page - 1) * pagination.per_page + 1;
}

function getLastItemIndex(pagination: NonNullable<ApiMeta['pagination']>, itemCount: number): number {
  if (pagination.total === 0) {
    return 0;
  }

  return getFirstItemIndex(pagination) + itemCount - 1;
}
