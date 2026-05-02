import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  formatDate,
  formatLabel,
  getErrorMessage,
} from '../components/adminUi.js';
import {
  cancelGraphifyRun,
  getGraphifyReport,
  getGraphifyRun,
  getGraphifySummary,
  retryGraphifyRun,
  type GraphifyReport,
  type GraphifyRun,
  type GraphifySummary,
} from '../lib/graphifyApi.js';
import {
  GraphifyStatusCell,
  asRecord,
  formatCount,
  formatJson,
  formatRunDuration,
  getGraphifyStat,
  getQuarantineType,
  isGraphifyRunActive,
  isQuarantined,
} from './graphifyUi.js';
import NotFound from './NotFound.js';

const GRAPHIFY_REFRESH_INTERVAL_MS = 5_000;

export default function GraphifyRunDetailPage() {
  const navigate = useNavigate();
  const { spaceId = '', runId = '' } = useParams();
  const [run, setRun] = useState<GraphifyRun | null>(null);
  const [report, setReport] = useState<GraphifyReport | null>(null);
  const [summary, setSummary] = useState<GraphifySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRunDetail = useCallback(
    async (background = false) => {
      if (runId.length === 0) {
        setRun(null);
        setReport(null);
        setSummary(null);
        setIsLoading(false);
        return;
      }

      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const runResponse = await getGraphifyRun(runId);
        setRun(runResponse.data);

        const [reportResult, summaryResult] = await Promise.allSettled([
          getGraphifyReport(runId),
          getGraphifySummary(runId),
        ]);
        setReport(reportResult.status === 'fulfilled' ? reportResult.value.data : null);
        setSummary(summaryResult.status === 'fulfilled' ? summaryResult.value.data : null);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        if (!background) {
          setIsLoading(false);
        }
      }
    },
    [runId],
  );

  useEffect(() => {
    void loadRunDetail();
  }, [loadRunDetail]);

  useEffect(() => {
    if (run === null || !isGraphifyRunActive(run)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadRunDetail(true);
    }, GRAPHIFY_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadRunDetail, run]);

  if (spaceId.length === 0 || runId.length === 0) {
    return <NotFound />;
  }

  async function cancelRun(): Promise<void> {
    if (run === null || !window.confirm(`Cancel Graphify run ${run.run_id}?`)) {
      return;
    }

    setIsCancelling(true);
    setError(null);

    try {
      await cancelGraphifyRun(run.run_id);
      setRun((current) => (current === null ? current : { ...current, status: 'cancelled', completed_at: new Date().toISOString() }));
      await loadRunDetail(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  }

  async function retryRun(): Promise<void> {
    if (run === null || !window.confirm(`Retry Graphify run ${run.run_id}?`)) {
      return;
    }

    setIsRetrying(true);
    setError(null);

    try {
      const created = await retryGraphifyRun(run.run_id);
      void navigate(`/spaces/${encodeURIComponent(created.space_id)}/graphify/${encodeURIComponent(created.run_id)}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsRetrying(false);
    }
  }

  const showCancelButton = run !== null && isGraphifyRunActive(run);
  const showRetryButton = run !== null && run.status === 'failed';

  return (
    <main className="admin-content graphify-page">
      <PageHeader
        title="Graphify Run Detail"
        description="Inspect Graphify metadata, import statistics, reports, and failures."
        actions={
          <>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                void navigate(`/spaces/${encodeURIComponent(spaceId)}/graphify`);
              }}
            >
              Back to Graphify
            </button>
            {showCancelButton ? (
              <button
                className="button button-danger"
                type="button"
                disabled={isCancelling}
                onClick={() => {
                  void cancelRun();
                }}
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Run'}
              </button>
            ) : null}
            {showRetryButton ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={isRetrying}
                onClick={() => {
                  void retryRun();
                }}
              >
                {isRetrying ? 'Retrying...' : 'Retry Run'}
              </button>
            ) : null}
          </>
        }
      />

      <ErrorBanner error={error} />

      {isLoading ? (
        <LoadingState label="Loading graphify run details..." />
      ) : run === null ? (
        <EmptyState label="Graphify run details are unavailable." />
      ) : (
        <>
          <section className="detail-panel" aria-label="Graphify run overview">
            <div className="detail-panel-header">
              <div>
                <h2>{run.run_id}</h2>
                <p>{run.space_id}</p>
              </div>
              <GraphifyStatusCell run={run} />
            </div>

            <div className="settings-grid">
              <div>
                <span className="eyebrow">Run ID</span>
                <code>{run.run_id}</code>
              </div>
              <div>
                <span className="eyebrow">Status</span>
                <StatusBadge status={run.status} />
              </div>
              <div>
                <span className="eyebrow">Mode</span>
                <span className="job-meta-value">{formatLabel(run.mode)}</span>
              </div>
              <div>
                <span className="eyebrow">Trigger</span>
                <span className="job-meta-value">{formatLabel(run.trigger_type)}</span>
              </div>
              <div>
                <span className="eyebrow">Duration</span>
                <span className="job-meta-value">{formatRunDuration(run)}</span>
              </div>
              <div>
                <span className="eyebrow">Created at</span>
                <span className="job-meta-value">{formatDate(run.created_at)}</span>
              </div>
              <div>
                <span className="eyebrow">Started at</span>
                <span className="job-meta-value">{formatDate(run.started_at)}</span>
              </div>
              <div>
                <span className="eyebrow">Completed at</span>
                <span className="job-meta-value">{formatDate(run.completed_at)}</span>
              </div>
              <div>
                <span className="eyebrow">Input scope</span>
                <span className="job-meta-value">{formatInputScope(run)}</span>
              </div>
            </div>
          </section>

          <section className="detail-panel" aria-label="Graphify run stats">
            <div className="detail-panel-header">
              <div>
                <h2>Stats</h2>
                <p>Imported graph and wiki output counts.</p>
              </div>
            </div>
            <div className="settings-grid">
              <StatCard label="Nodes" value={summary?.summary.node_count ?? getGraphifyStat(run, 'node_count')} />
              <StatCard label="Edges" value={summary?.summary.edge_count ?? getGraphifyStat(run, 'edge_count')} />
              <StatCard
                label="Communities"
                value={summary?.summary.community_count ?? getGraphifyStat(run, 'community_count')}
              />
              <StatCard label="Wiki pages" value={getGraphifyStat(run, 'wiki_page_count')} />
            </div>
          </section>

          <section className="detail-panel" aria-label="Graphify report">
            <div className="detail-panel-header">
              <div>
                <h2>GRAPH_REPORT.md</h2>
                <p>{report === null ? 'No report has been captured for this run.' : `Generated ${formatDate(report.generated_at)}`}</p>
              </div>
            </div>
            {report === null ? (
              <EmptyState label="No Graphify report is available for this run." />
            ) : (
              <pre className="graphify-report-pre">{report.content}</pre>
            )}
          </section>

          {run.status === 'failed' ? (
            <section className="detail-panel" aria-label="Graphify error details">
              <div className="detail-panel-header">
                <div>
                  <h2>Error Details</h2>
                  <p>
                    {isQuarantined(run)
                      ? `Quarantine: ${formatLabel(getQuarantineType(run) ?? 'unknown')}`
                      : 'Failure metadata captured for this run.'}
                  </p>
                </div>
              </div>
              <details className="job-json-disclosure" open>
                <summary>Error JSON</summary>
                <pre>{formatJson(run.error_json)}</pre>
              </details>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <span className="job-meta-value">{formatCount(value)}</span>
    </div>
  );
}

function formatInputScope(run: GraphifyRun): string {
  const inputScope = asRecord(run.input_scope);
  const sourceDocumentIds = readStringArray(inputScope.source_document_ids);
  const pageIds = readStringArray(inputScope.page_ids);

  if (sourceDocumentIds.length > 0) {
    return sourceDocumentIds.join(', ');
  }

  if (pageIds.length > 0) {
    return pageIds.join(', ');
  }

  return 'All available sources';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
