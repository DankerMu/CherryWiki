import { ReloadOutlined } from '@ant-design/icons';
import { Button, Input, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { type ApiMeta } from '../../lib/api';
import { formatDate, formatLabel, getErrorMessage } from '../../components/adminUi';
import {
  GRAPHIFY_TRIGGER_TYPES,
  adminListGraphifyRuns,
  adminRetryRun,
  type GraphifyRun,
} from '../../lib/graphifyApi';
import {
  GRAPHIFY_PAGE_SIZE,
  formatCount,
  getGraphifyStat,
  getQuarantineType,
  isGraphifyRunActive,
  isQuarantined,
} from '../graphifyUi';

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: GRAPHIFY_PAGE_SIZE,
  total: 0,
  has_next: false,
};

const GRAPHIFY_POLL_INTERVAL_MS = 5_000;

function graphifyStatusColor(status: string): string {
  if (status === 'succeeded') return 'green';
  if (status === 'running') return 'blue';
  if (status === 'failed') return 'red';
  if (status === 'cancelled') return 'default';
  return 'orange';
}

function GraphifyPage() {
  const { t } = useTranslation();
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

  const loadRuns = useCallback(
    async (background = false) => {
      if (!background) setIsLoading(true);

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
        void message.error(getErrorMessage(err));
      } finally {
        if (!background) setIsLoading(false);
      }
    },
    [deferredSpaceId, page, perPage, status, triggerType],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const shouldPoll = runs.some(isGraphifyRunActive) || status === 'pending' || status === 'running';

  useEffect(() => {
    if (!shouldPoll) return;

    const intervalId = window.setInterval(() => {
      void loadRuns(true);
    }, GRAPHIFY_POLL_INTERVAL_MS);

    return () => { window.clearInterval(intervalId); };
  }, [loadRuns, shouldPoll]);

  async function retryRun(run: GraphifyRun): Promise<void> {
    setRetryingRunId(run.run_id);

    try {
      await adminRetryRun(run.run_id);
      void message.success(t('admin.graphify.retrySuccess'));
      await loadRuns(true);
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setRetryingRunId(null);
    }
  }

  function openRun(run: GraphifyRun): void {
    void navigate(`/spaces/${encodeURIComponent(run.space_id)}/graphify/${encodeURIComponent(run.run_id)}`);
  }

  const statusTabItems = [
    { key: '', label: t('admin.graphify.statusFilter.all') },
    { key: 'pending', label: t('admin.graphify.statusFilter.pending') },
    { key: 'running', label: t('admin.graphify.statusFilter.running') },
    { key: 'succeeded', label: t('admin.graphify.statusFilter.succeeded') },
    { key: 'failed', label: t('admin.graphify.statusFilter.failed') },
    { key: 'cancelled', label: t('admin.graphify.statusFilter.cancelled') },
  ];

  const columns: ColumnsType<GraphifyRun> = [
    {
      title: t('admin.graphify.columns.run'),
      key: 'run',
      render: (_: unknown, run: GraphifyRun) => (
        <div>
          <Typography.Text strong>{run.run_id}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {run.result.report_uri ?? t('admin.graphify.noReport')}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t('admin.graphify.columns.status'),
      key: 'status',
      render: (_: unknown, run: GraphifyRun) => (
        <Space direction="vertical" size={0}>
          <Tag color={graphifyStatusColor(run.status)}>
            {t(`common.status.${run.status}`, run.status)}
          </Tag>
          {isQuarantined(run) ? (
            <Tag color="warning">
              {t('admin.graphify.quarantine')}: {formatLabel(getQuarantineType(run) ?? 'unknown')}
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('admin.graphify.columns.space'),
      dataIndex: 'space_id',
      key: 'space_id',
    },
    {
      title: t('admin.graphify.columns.mode'),
      dataIndex: 'mode',
      key: 'mode',
      render: (val: string) => formatLabel(val),
    },
    {
      title: t('admin.graphify.columns.trigger'),
      dataIndex: 'trigger_type',
      key: 'trigger_type',
      render: (val: string) => formatLabel(val),
    },
    {
      title: t('admin.graphify.columns.timing'),
      key: 'timing',
      render: (_: unknown, run: GraphifyRun) => (
        <div>
          <Typography.Text strong>{formatRunDurationI18n(run, t)}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('admin.graphify.created', { date: formatDate(run.created_at) })}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t('admin.graphify.columns.stats'),
      key: 'stats',
      render: (_: unknown, run: GraphifyRun) => formatGraphifyStatsI18n(run, t),
    },
    {
      title: t('admin.graphify.columns.actions'),
      key: 'actions',
      render: (_: unknown, run: GraphifyRun) => (
        <Space>
          {run.status === 'failed' ? (
            <Popconfirm
              title={t('admin.graphify.confirmRetry')}
              onConfirm={(e) => {
                e?.stopPropagation();
                void retryRun(run);
              }}
              onCancel={(e) => { e?.stopPropagation(); }}
              okText={t('common.action.confirm')}
              cancelText={t('common.action.cancel')}
            >
              <Button
                size="small"
                loading={retryingRunId === run.run_id}
                onClick={(e) => { e.stopPropagation(); }}
              >
                {t('common.action.retry')}
              </Button>
            </Popconfirm>
          ) : null}
          {run.status === 'failed' && run.error_json ? (
            <Typography.Text
              type="danger"
              style={{ fontSize: 12, cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); }}
            >
              {t('admin.graphify.error')}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.graphify.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.graphify.description')}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { void loadRuns(); }}>
          {t('common.action.refresh')}
        </Button>
      </div>

      <Tabs
        activeKey={status}
        onChange={(key) => { setStatus(key); setPage(1); }}
        items={statusTabItems}
        style={{ marginBottom: 16 }}
      />

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          value={triggerType || undefined}
          onChange={(val) => { setTriggerType(val ?? ''); setPage(1); }}
          placeholder={t('admin.graphify.filter.allTriggers')}
          allowClear
          style={{ width: 180 }}
        >
          {GRAPHIFY_TRIGGER_TYPES.map((option) => (
            <Select.Option key={option} value={option}>{formatLabel(option)}</Select.Option>
          ))}
        </Select>
        <Input.Search
          placeholder={t('admin.graphify.filter.spacePlaceholder')}
          value={spaceId}
          onChange={(e) => { setSpaceId(e.target.value); setPage(1); }}
          allowClear
          style={{ width: 200 }}
        />
      </Space>

      <Table<GraphifyRun>
        columns={columns}
        dataSource={runs}
        rowKey="run_id"
        loading={isLoading}
        onRow={(run) => ({
          onClick: () => openRun(run),
          style: { cursor: 'pointer', ...(isQuarantined(run) ? { background: 'var(--ant-color-warning-bg)' } : {}) },
        })}
        pagination={{
          current: page,
          pageSize: perPage,
          total: pagination.total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (p, ps) => { setPage(p); setPerPage(ps); },
          showTotal: (total, range) => t('admin.graphify.pagination.showing', { from: range[0], to: range[1], total }),
        }}
        locale={{ emptyText: t('admin.graphify.emptyFilter') }}
        size="middle"
      />
    </>
  );
}

function formatGraphifyStatsI18n(run: GraphifyRun, t: (key: string) => string): string {
  return [
    `${t('admin.graphify.stats.nodes')} ${formatCount(getGraphifyStat(run, 'node_count'))}`,
    `${t('admin.graphify.stats.edges')} ${formatCount(getGraphifyStat(run, 'edge_count'))}`,
    `${t('admin.graphify.stats.wiki')} ${formatCount(getGraphifyStat(run, 'wiki_page_count'))}`,
  ].join(' / ');
}

function formatRunDurationI18n(run: GraphifyRun, t: (key: string) => string): string {
  if (run.started_at === null) {
    return run.status === 'pending' ? t('common.status.pending') : t('admin.graphify.timing.notStarted');
  }

  const startMs = new Date(run.started_at).getTime();
  if (Number.isNaN(startMs)) return t('admin.graphify.timing.unavailable');

  const endMs = run.completed_at !== null
    ? new Date(run.completed_at).getTime()
    : run.status === 'running' ? Date.now() : null;

  if (endMs === null || Number.isNaN(endMs)) return t('admin.graphify.timing.unavailable');

  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export default requireAdminPage(GraphifyPage);
