import { useCallback, useEffect, useState } from 'react';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  formatDate,
  getErrorMessage,
} from '../../components/adminUi';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { type AuditLog } from '../../lib/adminTypes';

function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [space, setSpace] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await api.get<AuditLog[]>('/admin/audit-logs', {
        action,
        actor,
        space,
        from,
        to,
        per_page: 100,
        sort: '-created_at',
      });
      setLogs(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [action, actor, from, space, to]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Review administrative and security-sensitive activity."
        actions={
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              void loadLogs();
            }}
          >
            Refresh
          </button>
        }
      />
      <ErrorBanner error={error} />

      <section className="toolbar" aria-label="Audit filters">
        <label>
          Action
          <input type="text" value={action} onChange={(event) => setAction(event.target.value)} placeholder="admin.user.update" />
        </label>
        <label>
          Actor
          <input type="text" value={actor} onChange={(event) => setActor(event.target.value)} placeholder="User ID" />
        </label>
        <label>
          Space
          <input type="text" value={space} onChange={(event) => setSpace(event.target.value)} placeholder="Space ID" />
        </label>
        <label>
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </section>

      {isLoading ? (
        <LoadingState />
      ) : logs.length === 0 ? (
        <EmptyState label="No audit logs match the current filters." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Space</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDate(log.created_at)}</td>
                  <td>{log.actor_user_id ?? 'System'}</td>
                  <td>
                    <code>{log.action}</code>
                  </td>
                  <td>
                    {log.resource_type}
                    {log.resource_id !== null ? <span className="subtle-id">{log.resource_id}</span> : null}
                  </td>
                  <td>{log.space_id ?? 'Global'}</td>
                  <td>{log.request_id ?? 'Not recorded'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default requireAdminPage(AuditPage);
