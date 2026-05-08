import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  formatDate,
  formatLabel,
  getErrorMessage,
} from '../../components/adminUi.js';
import { requireAdminPage } from '../../components/RequireAdminPage.js';
import { type ApiMeta } from '../../lib/api.js';
import {
  GRAPHIFY_TRIGGER_TYPES,
  adminListGraphifyRuns,
  adminRetryRun,
  type GraphifyRun,
} from '../../lib/graphifyApi.js';
import {
  GRAPHIFY_PAGE_SIZE,
  GraphifyStatusCell,
  GraphifyStatusTabs,
  formatGraphifyStats,
  formatJson,
  formatRunDuration,
  getFirstItemIndex,
  getLastItemIndex,
  getQuarantineType,
  isGraphifyRunActive,
  isQuarantined,
} from '../graphifyUi.js';

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: GRAPHIFY_PAGE_SIZE,
  total: 0,
  has_next: false,
};

const GRAPHIFY_POLL_INTERVAL_MS = 5_000;
const PER_PAGE_OPTIONS = [10, 20, 50, 100];

function GraphifyPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<GraphifyRun[]>([]);
  const [status, setStatus] = useState('failed');
  const [triggerType, setTriggerType] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const deferredSpaceId = useDeferredValue(spaceId);
  const [page, setPage] = useState(DEFAULT_PAGINATION.page);
  const [perPage, setPerPage] = useState(DEFAULT_PAGINATION.per_page);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(
    async (background = false) => {
      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await adminListGraphifyRuns({
          status,
          trigger_type: triggerType,
          space_id: deferredSpaceId,
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
    [deferredSpaceId, page, perPage, status, triggerType],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

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

  async function retryRun(run: GraphifyRun): Promise<void> {
    if (!window.confirm(`Retry Graphify run ${run.run_id}?`)) {
      return;
    }

    setRetryingRunId(run.run_id);
    setError(null);

    try {
      await adminRetryRun(run.run_id);
      await loadRuns(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRetryingRunId(null);
    }
  }

  function openRun(run: GraphifyRun): void {
    void navigate(`/spaces/${encodeURIComponent(run.space_id)}/graphify/${encodeURIComponent(run.run_id)}`);
  }

  return (
    <>
      <PageHeader
        title="Graphify"
        description="Review graphification runs and quarantine failures across spaces."
        actions={
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              void loadRuns();
            }}
          >
            Refresh
          </button>
        }
      />

      <ErrorBanner error={error} />

      <section className="toolbar" aria-label="Graphify filters">
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
                  <th>Space</th>
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
                    className={isQuarantined(run) ? 'interactive-row graphify-quarantined-row' : 'interactive-row'}
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
                      {isQuarantined(run) ? (
                        <span className="subtle-id">Quarantine: {formatLabel(getQuarantineType(run) ?? 'unknown')}</span>
                      ) : null}
                    </td>
                    <td>{run.space_id}</td>
                    <td>{formatLabel(run.mode)}</td>
                    <td>{formatLabel(run.trigger_type)}</td>
                    <td>
                      <strong>{formatRunDuration(run)}</strong>
                      <span className="subtle-id">Created {formatDate(run.created_at)}</span>
                    </td>
                    <td>{formatGraphifyStats(run)}</td>
                    <td>
                      <div className="row-actions">
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
                        {run.status === 'failed' ? (
                          <details
                            className="graphify-inline-details"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <summary>Error</summary>
                            <pre>{formatJson(run.error_json)}</pre>
                          </details>
                        ) : null}
                      </div>
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
    </>
  );
}

export default requireAdminPage(GraphifyPage);
