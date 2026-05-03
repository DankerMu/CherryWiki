import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  formatDate,
  formatLabel,
  getErrorMessage,
} from '../components/adminUi.js';
import SpaceNav from '../components/SpaceNav.js';
import { type ApiMeta } from '../lib/api.js';
import {
  GRAPHIFY_TRIGGER_TYPES,
  createGraphifyRun,
  listGraphifyRuns,
  retryGraphifyRun,
  type CreateGraphifyRunParams,
  type GraphifyRun,
} from '../lib/graphifyApi.js';
import {
  GRAPHIFY_PAGE_SIZE,
  GraphifyStatusCell,
  GraphifyStatusTabs,
  NewRunDialog,
  formatGraphifyStats,
  formatRunDuration,
  getFirstItemIndex,
  getLastItemIndex,
  isGraphifyRunActive,
} from './graphifyUi.js';
import NotFound from './NotFound.js';

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: GRAPHIFY_PAGE_SIZE,
  total: 0,
  has_next: false,
};

const GRAPHIFY_POLL_INTERVAL_MS = 5_000;
const PER_PAGE_OPTIONS = [10, 20, 50, 100];

export default function GraphifyRunsPage() {
  const navigate = useNavigate();
  const { spaceId = '' } = useParams();
  const [runs, setRuns] = useState<GraphifyRun[]>([]);
  const [status, setStatus] = useState('');
  const [triggerType, setTriggerType] = useState('');
  const [page, setPage] = useState(DEFAULT_PAGINATION.page);
  const [perPage, setPerPage] = useState(DEFAULT_PAGINATION.per_page);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [isNewRunOpen, setIsNewRunOpen] = useState(false);
  const [isCreatingRun, setIsCreatingRun] = useState(false);

  const loadRuns = useCallback(
    async (background = false) => {
      if (spaceId.length === 0) {
        setRuns([]);
        setPagination(DEFAULT_PAGINATION);
        setIsLoading(false);
        return;
      }

      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await listGraphifyRuns({
          space_id: spaceId,
          status,
          trigger_type: triggerType,
          page,
          per_page: perPage,
          sort: '-created_at',
        });
        setRuns(response.data);
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
    [page, perPage, spaceId, status, triggerType],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    setPage(1);
  }, [spaceId]);

  const shouldPoll = runs.some(isGraphifyRunActive) || status === 'pending' || status === 'running';

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadRuns(true);
    }, GRAPHIFY_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadRuns, shouldPoll]);

  const totalPages = useMemo(() => {
    const computedPages = Math.ceil(pagination.total / Math.max(1, pagination.per_page));
    return Math.max(page, computedPages, 1);
  }, [page, pagination.per_page, pagination.total]);

  if (spaceId.length === 0) {
    return <NotFound />;
  }

  async function createRun(params: CreateGraphifyRunParams): Promise<void> {
    setIsCreatingRun(true);
    setError(null);

    try {
      await createGraphifyRun(spaceId, params);
      setIsNewRunOpen(false);
      setPage(1);
      await loadRuns(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsCreatingRun(false);
    }
  }

  async function retryRun(run: GraphifyRun): Promise<void> {
    if (!window.confirm(`Retry Graphify run ${run.run_id}?`)) {
      return;
    }

    setRetryingRunId(run.run_id);
    setError(null);

    try {
      await retryGraphifyRun(run.run_id);
      await loadRuns(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRetryingRunId(null);
    }
  }

  function openRun(run: GraphifyRun): void {
    void navigate(`/spaces/${encodeURIComponent(spaceId)}/graphify/${encodeURIComponent(run.run_id)}`);
  }

  return (
    <main className="admin-content graphify-page">
      <PageHeader
        title="Graphify Runs"
        description="Create and track Graphify output imports for this space."
        actions={
          <>
            <SpaceNav spaceId={spaceId} />
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                void loadRuns();
              }}
            >
              Refresh
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setIsNewRunOpen(true);
              }}
            >
              New Run
            </button>
          </>
        }
      />

      <ErrorBanner error={error} />

      <section className="toolbar" aria-label="Graphify run filters">
        <div className="toolbar-span">
          <span className="eyebrow">Status</span>
          <GraphifyStatusTabs
            status={status}
            onStatusChange={(nextStatus) => {
              setStatus(nextStatus);
              setPage(1);
            }}
          />
        </div>
        <label>
          Trigger
          <select
            value={triggerType}
            onChange={(event) => {
              setTriggerType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All triggers</option>
            {GRAPHIFY_TRIGGER_TYPES.map((option) => (
              <option key={option} value={option}>
                {formatLabel(option)}
              </option>
            ))}
          </select>
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
        <LoadingState label="Loading graphify runs..." />
      ) : runs.length === 0 ? (
        <EmptyState label="No graphify runs match the current filters." />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Trigger</th>
                  <th>Timing</th>
                  <th>Stats</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.run_id}
                    className="interactive-row"
                    role="link"
                    tabIndex={0}
                    onClick={() => openRun(run)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openRun(run);
                      }
                    }}
                  >
                    <td>
                      <strong>{run.run_id}</strong>
                      <span className="subtle-id">{run.result.report_uri ?? 'No report yet'}</span>
                    </td>
                    <td>
                      <GraphifyStatusCell run={run} />
                    </td>
                    <td>{formatLabel(run.mode)}</td>
                    <td>{formatLabel(run.trigger_type)}</td>
                    <td>
                      <strong>{formatRunDuration(run)}</strong>
                      <span className="subtle-id">Created {formatDate(run.created_at)}</span>
                    </td>
                    <td>{formatGraphifyStats(run)}</td>
                    <td>
                      {run.status === 'failed' ? (
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={retryingRunId === run.run_id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void retryRun(run);
                          }}
                        >
                          {retryingRunId === run.run_id ? 'Retrying...' : 'Retry'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <span className="pagination-summary">
              Showing {getFirstItemIndex(pagination.page, pagination.per_page, pagination.total)}-
              {getLastItemIndex(pagination.page, pagination.per_page, runs.length, pagination.total)} of{' '}
              {pagination.total}
            </span>
            <span className="pagination-summary">
              Page {pagination.page} of {totalPages}
            </span>
          </div>
        </>
      )}

      {isNewRunOpen ? (
        <NewRunDialog
          isSubmitting={isCreatingRun}
          onClose={() => setIsNewRunOpen(false)}
          onSubmit={(params) => createRun(params)}
        />
      ) : null}
    </main>
  );
}
