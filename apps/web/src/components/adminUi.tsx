import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="admin-page-header">
      <div>
        <h1>{title}</h1>
        {description !== undefined ? <p>{description}</p> : null}
      </div>
      {actions !== undefined ? <div className="admin-page-actions">{actions}</div> : null}
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (error === null) {
    return null;
  }

  return (
    <div className="alert alert-error" role="alert">
      {error}
    </div>
  );
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return <div className="muted-state">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="muted-state">{label}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${normalizeStatusClass(status)}`}>{formatLabel(status)}</span>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            x
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) {
    return 'Never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatLabel(value: string): string {
  return value
    .split('_')
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}` : part))
    .join(' ');
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong';
}

export function parseIdList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeStatusClass(status: string): string {
  if (status === 'healthy' || status === 'active' || status === 'enabled' || status === 'succeeded') {
    return 'healthy';
  }

  if (status === 'running') {
    return 'info';
  }

  if (status === 'degraded') {
    return 'degraded';
  }

  if (status === 'not_configured' || status === 'pending' || status === 'cancelled') {
    return 'neutral';
  }

  if (status === 'disabled') {
    return 'neutral';
  }

  return 'unhealthy';
}
