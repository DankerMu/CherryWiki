import { useCallback, useEffect, useState } from 'react';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  formatLabel,
  getErrorMessage,
} from '../../components/adminUi';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { type SystemHealth } from '../../lib/adminTypes';

const REFRESH_INTERVAL_MS = 30_000;

function HealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setError(null);

    try {
      const data = await api.get<SystemHealth>('/admin/system/health');
      setHealth(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    const intervalId = window.setInterval(() => {
      void loadHealth();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadHealth]);

  return (
    <>
      <PageHeader
        title="System Health"
        description="Monitor API dependencies and configured infrastructure."
        actions={
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              void loadHealth();
            }}
          >
            Refresh
          </button>
        }
      />
      <ErrorBanner error={error} />

      {isLoading ? (
        <LoadingState />
      ) : health === null ? (
        <EmptyState label="System health is unavailable." />
      ) : (
        <>
          <section className="health-summary">
            <div>
              <span className="eyebrow">Overall status</span>
              <StatusBadge status={health.status} />
            </div>
            <div>
              <span className="eyebrow">API uptime</span>
              <strong>{formatUptime(health.uptime)}</strong>
            </div>
            <div>
              <span className="eyebrow">Auto refresh</span>
              <strong>Every 30 seconds</strong>
            </div>
          </section>

          <section className="health-grid" aria-label="Component health">
            {Object.entries(health.components).map(([name, component]) => (
              <article key={name} className={`health-card health-${component.status}`}>
                <div className="health-card-header">
                  <h2>{formatLabel(name)}</h2>
                  <StatusBadge status={component.status} />
                </div>
                <dl>
                  <div>
                    <dt>Latency</dt>
                    <dd>{component.latency_ms !== undefined ? `${component.latency_ms} ms` : 'N/A'}</dd>
                  </div>
                  <div>
                    <dt>Details</dt>
                    <dd>{component.error ?? (component.status === 'not_configured' ? 'Not configured' : 'Operational')}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}

export default requireAdminPage(HealthPage);

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}
