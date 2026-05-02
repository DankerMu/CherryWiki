import { useState, type FormEvent } from 'react';
import {
  Modal,
  StatusBadge,
  formatLabel,
} from '../components/adminUi.js';
import {
  GRAPHIFY_RUN_MODES,
  type CreateGraphifyRunParams,
  type GraphifyRun,
  type GraphifyRunMode,
  type GraphifyTriggerType,
} from '../lib/graphifyApi.js';

export const GRAPHIFY_PAGE_SIZE = 20;

export const GRAPHIFY_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

export function GraphifyStatusCell({ run }: { run: GraphifyRun }) {
  return (
    <span className="graphify-status-cell">
      <StatusBadge status={run.status} />
      {isQuarantined(run) ? (
        <span className="quarantine-icon" role="img" aria-label="Quarantined" title="Quarantined">
          !
        </span>
      ) : null}
    </span>
  );
}

export function GraphifyStatusTabs({
  status,
  onStatusChange,
}: {
  status: string;
  onStatusChange: (status: string) => void;
}) {
  return (
    <div className="status-filter-tabs" role="tablist" aria-label="Graphify status filters">
      {GRAPHIFY_STATUS_FILTERS.map((option) => (
        <button
          key={option.value || 'all'}
          className={status === option.value ? 'status-filter-tab active' : 'status-filter-tab'}
          type="button"
          role="tab"
          aria-selected={status === option.value}
          onClick={() => onStatusChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function NewRunDialog({
  isSubmitting,
  onClose,
  onSubmit,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (params: CreateGraphifyRunParams) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<GraphifyRunMode>('full');
  const [triggerType, setTriggerType] = useState<GraphifyTriggerType>('manual');

  async function submitForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onSubmit({
      mode,
      trigger_type: triggerType,
    });
  }

  return (
    <Modal title="New Graphify Run" onClose={onClose}>
      <form className="form-grid" onSubmit={(event) => void submitForm(event)}>
        <label>
          Mode
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as GraphifyRunMode);
            }}
          >
            {GRAPHIFY_RUN_MODES.map((option) => (
              <option key={option} value={option}>
                {formatLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trigger type
          <select
            value={triggerType}
            onChange={(event) => {
              setTriggerType(event.target.value as GraphifyTriggerType);
            }}
          >
            <option value="manual">Manual</option>
          </select>
        </label>
        <div className="form-actions span-2">
          <button className="button button-secondary" type="button" disabled={isSubmitting} onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Run'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function isGraphifyRunActive(run: GraphifyRun): boolean {
  return run.status === 'pending' || run.status === 'running';
}

export function isQuarantined(run: GraphifyRun): boolean {
  const error = asRecord(run.error_json);
  return run.status === 'failed' && readString(error.reason) === 'quarantined';
}

export function getQuarantineType(run: GraphifyRun): string | null {
  const error = asRecord(run.error_json);
  const details = asRecord(error.details);
  return (
    readString(error.quarantine_type) ??
    readString(details.quarantine_type) ??
    readString(details.check) ??
    null
  );
}

export function formatGraphifyStats(run: GraphifyRun): string {
  return [
    `Nodes ${formatCount(getGraphifyStat(run, 'node_count'))}`,
    `Edges ${formatCount(getGraphifyStat(run, 'edge_count'))}`,
    `Wiki ${formatCount(getGraphifyStat(run, 'wiki_page_count'))}`,
  ].join(' / ');
}

export function getGraphifyStat(
  run: GraphifyRun,
  stat: 'node_count' | 'edge_count' | 'wiki_page_count' | 'community_count',
): number | null {
  const stats = asRecord(run.stats_json);
  const result = asRecord(run.result);

  if (stat === 'node_count') {
    return readNumber(stats.node_count) ?? readNumber(result.node_count) ?? readNumber(result.nodes_created);
  }

  if (stat === 'edge_count') {
    return readNumber(stats.edge_count) ?? readNumber(result.edge_count) ?? readNumber(result.edges_created);
  }

  if (stat === 'wiki_page_count') {
    return (
      readNumber(stats.wiki_page_count) ??
      readNumber(result.wiki_page_count) ??
      readNumber(result.wiki_pages_generated)
    );
  }

  return readNumber(stats.community_count) ?? readNumber(result.community_count);
}

export function formatCount(value: number | null): string {
  return value === null ? '0' : value.toLocaleString();
}

export function formatRunDuration(run: GraphifyRun): string {
  if (run.started_at === null) {
    return run.status === 'pending' ? 'Queued' : 'Not started';
  }

  const startedAt = parseTimestamp(run.started_at);
  if (startedAt === null) {
    return 'Unavailable';
  }

  const completedAt =
    run.completed_at !== null ? parseTimestamp(run.completed_at) : run.status === 'running' ? Date.now() : null;

  if (completedAt === null) {
    return 'In progress';
  }

  return formatElapsedTime(completedAt - startedAt);
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function getFirstItemIndex(page: number, perPage: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return (page - 1) * perPage + 1;
}

export function getLastItemIndex(page: number, perPage: number, itemCount: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.min(total, getFirstItemIndex(page, perPage, total) + itemCount - 1);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
