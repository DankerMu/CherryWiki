import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
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
import { api } from '../../lib/api';
import { type AdminJob, type CancelJobResponse, type JobEvent, getDisplayStatus } from '../../lib/adminTypes';

const JOB_REFRESH_INTERVAL_MS = 5_000;

function JobDetailPage() {
  const navigate = useNavigate();
  const { jobId = '' } = useParams();
  const [job, setJob] = useState<AdminJob | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobDetail = useCallback(
    async (background = false) => {
      if (jobId.length === 0) {
        setJob(null);
        setEvents([]);
        setIsLoading(false);
        return;
      }

      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const [jobResponse, eventResponse] = await Promise.all([
          api.get<AdminJob>(`/jobs/${jobId}`),
          api.get<JobEvent[]>(`/jobs/${jobId}/events`, {
            limit: 100,
            offset: 0,
          }),
        ]);
        setJob(jobResponse);
        setEvents(eventResponse);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        if (!background) {
          setIsLoading(false);
        }
      }
    },
    [jobId],
  );

  useEffect(() => {
    void loadJobDetail();
  }, [loadJobDetail]);

  useEffect(() => {
    if (job?.status !== 'running') {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadJobDetail(true);
    }, JOB_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [job?.status, loadJobDetail]);

  async function cancelJob(): Promise<void> {
    if (job === null) {
      return;
    }

    setIsCancelling(true);
    setError(null);

    try {
      const response = await api.post<CancelJobResponse>(`/jobs/${job.job_id}/cancel`);
      setJob((current) =>
        current === null
          ? current
          : {
              ...current,
              status: response.status,
              cancel_requested_at: response.cancel_requested_at,
            },
      );
      await loadJobDetail(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  }

  const showCancelButton = job !== null && (job.status === 'pending' || job.status === 'running');
  const isCancellationPending = job !== null && job.status === 'running' && job.cancel_requested_at !== null;
  const cancelButtonLabel = isCancellationPending || isCancelling ? 'Cancelling...' : 'Cancel Job';

  return (
    <>
      <PageHeader
        title="Job Detail"
        description="Inspect payloads, progress, and lifecycle events for a background task."
        actions={
          <>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                void navigate('/admin/jobs');
              }}
            >
              Back to Jobs
            </button>
            {showCancelButton ? (
              <button
                className="button button-danger"
                type="button"
                disabled={isCancelling || isCancellationPending}
                onClick={() => {
                  void cancelJob();
                }}
              >
                {cancelButtonLabel}
              </button>
            ) : null}
          </>
        }
      />

      <ErrorBanner error={error} />

      {isLoading ? (
        <LoadingState label="Loading job details..." />
      ) : job === null ? (
        <EmptyState label="Job details are unavailable." />
      ) : (
        <>
          <section className="detail-panel" aria-label="Job overview">
            <div className="detail-panel-header">
              <div>
                <h2>{formatLabel(job.type)}</h2>
                <p>{job.job_id}</p>
              </div>
              <StatusBadge status={getDisplayStatus(job)} />
            </div>

            {job.progress?.percent !== undefined ? (
              <ProgressBar percent={job.progress.percent} stage={job.progress?.stage ?? (job.status === 'running' ? 'Running' : 'Complete')} size="md" />
            ) : null}

            <div className="settings-grid">
              <div>
                <span className="eyebrow">Job ID</span>
                <code>{job.job_id}</code>
              </div>
              <div>
                <span className="eyebrow">Type</span>
                <span className="job-meta-value">{formatLabel(job.type)}</span>
              </div>
              <div>
                <span className="eyebrow">Status</span>
                <StatusBadge status={getDisplayStatus(job)} />
              </div>
              <div>
                <span className="eyebrow">Space</span>
                <span className="job-meta-value">{job.space_id ?? 'Global'}</span>
              </div>
              <div>
                <span className="eyebrow">Created by</span>
                <span className="job-meta-value">{job.created_by ?? 'System'}</span>
              </div>
              <div>
                <span className="eyebrow">Created at</span>
                <span className="job-meta-value">{formatDate(job.created_at)}</span>
              </div>
              <div>
                <span className="eyebrow">Started at</span>
                <span className="job-meta-value">{formatDate(job.started_at)}</span>
              </div>
              <div>
                <span className="eyebrow">Completed at</span>
                <span className="job-meta-value">{formatDate(job.completed_at)}</span>
              </div>
              {job.cancel_requested_at !== null ? (
                <div>
                  <span className="eyebrow">Cancellation requested</span>
                  <span className="job-meta-value">{formatDate(job.cancel_requested_at)}</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="detail-panel" aria-label="Job data">
            <div className="detail-panel-header">
              <div>
                <h2>Job Data</h2>
                <p>Payload, result, and error snapshots captured during execution.</p>
              </div>
            </div>

            <details className="job-json-disclosure" open>
              <summary>Payload JSON</summary>
              <pre>{formatJson(job.payload_json)}</pre>
            </details>
            <details className="job-json-disclosure">
              <summary>Result JSON</summary>
              <pre>{formatJson(job.result_json)}</pre>
            </details>
            <details className="job-json-disclosure">
              <summary>Error JSON</summary>
              <pre>{formatJson(job.error_json)}</pre>
            </details>
          </section>

          <section className="detail-panel" aria-label="Job events">
            <div className="detail-panel-header">
              <div>
                <h2>Event Timeline</h2>
                <p>Chronological state transitions and progress updates from the job lifecycle.</p>
              </div>
            </div>

            {events.length === 0 ? (
              <EmptyState label="No job events have been recorded yet." />
            ) : (
              <ol className="job-timeline">
                {events.map((event, index) => (
                  <li key={`${event.timestamp}-${event.event}-${index}`} className="job-timeline-item">
                    <span className="job-timeline-marker" aria-hidden="true" />
                    <article className="job-timeline-card">
                      <div className="job-timeline-header">
                        <strong>{formatLabel(event.event)}</strong>
                        <span>{formatDate(event.timestamp)}</span>
                      </div>
                      <pre className="timeline-event-detail">{formatJson(event.detail)}</pre>
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default requireAdminPage(JobDetailPage);

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}
