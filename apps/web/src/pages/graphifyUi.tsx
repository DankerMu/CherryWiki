import { ExclamationCircleOutlined } from '@ant-design/icons';
import { Button, Form, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLabel } from '../components/adminUi';
import {
  GRAPHIFY_RUN_MODES,
  type CreateGraphifyRunParams,
  type GraphifyRun,
  type GraphifyRunMode,
  type GraphifyTriggerType,
} from '../lib/graphifyApi';

export const GRAPHIFY_PAGE_SIZE = 20;

export const GRAPHIFY_STATUS_FILTERS = [
  { value: '', labelKey: 'graphify.space.statusFilter.all' },
  { value: 'pending', labelKey: 'graphify.space.statusFilter.pending' },
  { value: 'running', labelKey: 'graphify.space.statusFilter.running' },
  { value: 'succeeded', labelKey: 'graphify.space.statusFilter.succeeded' },
  { value: 'failed', labelKey: 'graphify.space.statusFilter.failed' },
  { value: 'cancelled', labelKey: 'graphify.space.statusFilter.cancelled' },
] as const;

function graphifyStatusColor(status: string): string {
  if (status === 'succeeded') return 'green';
  if (status === 'running') return 'blue';
  if (status === 'failed') return 'red';
  if (status === 'cancelled') return 'default';
  return 'orange';
}

export function GraphifyStatusCell({ run }: { run: GraphifyRun }) {
  const { t } = useTranslation();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Tag color={graphifyStatusColor(run.status)}>{formatLabel(run.status)}</Tag>
      {isQuarantined(run) && (
        <ExclamationCircleOutlined style={{ color: '#faad14' }} title={t('graphify.space.quarantined')} />
      )}
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
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {GRAPHIFY_STATUS_FILTERS.map((option) => (
        <Button
          key={option.value || 'all'}
          type={status === option.value ? 'primary' : 'default'}
          size="small"
          onClick={() => onStatusChange(option.value)}
        >
          {t(option.labelKey)}
        </Button>
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
  const { t } = useTranslation();
  const [mode, setMode] = useState<GraphifyRunMode>('full');
  const [triggerType, setTriggerType] = useState<GraphifyTriggerType>('manual');

  function handleOk(): void {
    void onSubmit({ mode, trigger_type: triggerType });
  }

  return (
    <Modal
      open
      title={t('graphify.space.newRunDialog.title')}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={isSubmitting}
      okText={isSubmitting ? t('graphify.space.newRunDialog.creating') : t('graphify.space.newRunDialog.createRun')}
      cancelText={t('common.action.cancel')}
    >
      <Form layout="vertical">
        <Form.Item label={t('graphify.space.newRunDialog.mode')}>
          <Select value={mode} onChange={(val) => setMode(val)}>
            {GRAPHIFY_RUN_MODES.map((option) => (
              <Select.Option key={option} value={option}>{formatLabel(option)}</Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item label={t('graphify.space.newRunDialog.triggerType')}>
          <Select value={triggerType} onChange={(val) => setTriggerType(val)}>
            <Select.Option value="manual">{t('graphify.space.newRunDialog.triggerManual')}</Select.Option>
          </Select>
        </Form.Item>
      </Form>
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

export function formatGraphifyStatsWithT(
  run: GraphifyRun,
  t: (key: string) => string,
): string {
  return [
    `${t('graphify.space.stats.nodes')} ${formatCount(getGraphifyStat(run, 'node_count'))}`,
    `${t('graphify.space.stats.edges')} ${formatCount(getGraphifyStat(run, 'edge_count'))}`,
    `${t('graphify.space.stats.wiki')} ${formatCount(getGraphifyStat(run, 'wiki_page_count'))}`,
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

export function formatRunDurationWithT(
  run: GraphifyRun,
  t: (key: string) => string,
): string {
  if (run.started_at === null) {
    return run.status === 'pending' ? t('graphify.space.timing.queued') : t('graphify.space.timing.notStarted');
  }

  const startedAt = parseTimestamp(run.started_at);
  if (startedAt === null) {
    return t('graphify.space.timing.unavailable');
  }

  const completedAt =
    run.completed_at !== null ? parseTimestamp(run.completed_at) : run.status === 'running' ? Date.now() : null;

  if (completedAt === null) {
    return t('graphify.space.timing.inProgress');
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
