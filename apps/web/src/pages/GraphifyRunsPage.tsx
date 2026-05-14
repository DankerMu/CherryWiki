import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Popconfirm, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { formatDate, formatLabel, getErrorMessage } from '../components/adminUi';
import { SpaceForbiddenState, useSpacePermissionGate } from '../components/SpacePermissionGate';
import { type ApiMeta } from '../lib/api';
import {
  GRAPHIFY_TRIGGER_TYPES,
  createGraphifyRun,
  listGraphifyRuns,
  retryGraphifyRun,
  type CreateGraphifyRunParams,
  type GraphifyRun,
} from '../lib/graphifyApi';
import {
  GRAPHIFY_PAGE_SIZE,
  GraphifyStatusCell,
  GraphifyStatusTabs,
  NewRunDialog,
  formatGraphifyStatsWithT,
  formatRunLabel,
  formatRunDurationWithT,
  isGraphifyRunActive,
} from './graphifyUi';
import { useAuth } from '../lib/auth';
import NotFound from './NotFound';

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: GRAPHIFY_PAGE_SIZE,
  total: 0,
  has_next: false,
};

const GRAPHIFY_POLL_INTERVAL_MS = 5_000;
const PER_PAGE_OPTIONS = [10, 20, 50, 100];

export default function GraphifyRunsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { spaceId = '' } = useParams();
  const { hasSpacePermission } = useAuth();
  const gate = useSpacePermissionGate('graphify:view');
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
  const canViewGraphify = spaceId.length > 0 && gate.isAllowed;
  const canRunGraphify = spaceId.length > 0 && hasSpacePermission(spaceId, 'graphify:run');

  const loadRuns = useCallback(
    async (background = false) => {
      if (spaceId.length === 0 || !canViewGraphify) {
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
    [canViewGraphify, page, perPage, spaceId, status, triggerType],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    setPage(1);
  }, [spaceId]);

  const shouldPoll = canViewGraphify && (runs.some(isGraphifyRunActive) || status === 'pending' || status === 'running');

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

  if (spaceId.length === 0) {
    return <NotFound />;
  }

  if (!canViewGraphify) {
    return <SpaceForbiddenState context="graphify" />;
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

  const columns: ColumnsType<GraphifyRun> = [
    {
      title: t('graphify.space.columns.run'),
      key: 'run',
      render: (_: unknown, run: GraphifyRun) => {
        const label = formatRunLabel(run, t);
        return (
          <div>
            <Typography.Text strong>{label.primary}</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {label.secondary}
            </Typography.Text>
          </div>
        );
      },
    },
    {
      title: t('graphify.space.columns.status'),
      key: 'status',
      render: (_: unknown, run: GraphifyRun) => <GraphifyStatusCell run={run} />,
    },
    {
      title: t('graphify.space.columns.mode'),
      dataIndex: 'mode',
      key: 'mode',
      render: (val: string) => formatLabel(val),
    },
    {
      title: t('graphify.space.columns.trigger'),
      dataIndex: 'trigger_type',
      key: 'trigger_type',
      render: (val: string) => formatLabel(val),
    },
    {
      title: t('graphify.space.columns.timing'),
      key: 'timing',
      render: (_: unknown, run: GraphifyRun) => (
        <div>
          <Typography.Text strong>{formatRunDurationWithT(run, t)}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('graphify.space.created', { date: formatDate(run.created_at) })}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t('graphify.space.columns.stats'),
      key: 'stats',
      render: (_: unknown, run: GraphifyRun) => formatGraphifyStatsWithT(run, t),
    },
    {
      title: t('graphify.space.columns.actions'),
      key: 'actions',
      render: (_: unknown, run: GraphifyRun) => {
        if (!canRunGraphify) return null;
        if (run.status !== 'failed') return null;
        return (
          <Popconfirm
            title={t('graphify.space.confirmRetry')}
            onConfirm={() => { void retryRun(run); }}
            onCancel={(e) => e?.stopPropagation()}
          >
            <Button
              size="small"
              loading={retryingRunId === run.run_id}
              onClick={(e) => e.stopPropagation()}
            >
              {t('common.action.retry')}
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('graphify.space.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('graphify.space.description')}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadRuns(); }}>
            {t('common.action.refresh')}
          </Button>
          {canRunGraphify && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsNewRunOpen(true)}>
              {t('graphify.space.newRun')}
            </Button>
          )}
        </Space>
      </div>

      {error !== null && (
        <Alert message={error} type="error" showIcon closable style={{ marginBottom: 12 }} onClose={() => setError(null)} />
      )}

      <Space style={{ marginBottom: 16 }} wrap>
        <GraphifyStatusTabs
          status={status}
          onStatusChange={(nextStatus) => { setStatus(nextStatus); setPage(1); }}
        />
        <Select
          value={triggerType || undefined}
          onChange={(val) => { setTriggerType(val ?? ''); setPage(1); }}
          placeholder={t('graphify.space.filter.allTriggers')}
          allowClear
          style={{ width: 160 }}
        >
          {GRAPHIFY_TRIGGER_TYPES.map((option) => (
            <Select.Option key={option} value={option}>{formatLabel(option)}</Select.Option>
          ))}
        </Select>
      </Space>

      <Table<GraphifyRun>
        columns={columns}
        dataSource={runs}
        rowKey="run_id"
        loading={isLoading}
        onRow={(run) => ({
          onClick: () => openRun(run),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize: perPage,
          total: pagination.total,
          showSizeChanger: true,
          pageSizeOptions: PER_PAGE_OPTIONS.map(String),
          onChange: (p, ps) => { setPage(p); setPerPage(ps); },
          showTotal: (totalItems, range) => t('graphify.space.pagination.showing', { from: range[0], to: range[1], total: totalItems }),
        }}
        locale={{ emptyText: t('graphify.space.emptyFilter') }}
        size="middle"
      />

      {canRunGraphify && isNewRunOpen && (
        <NewRunDialog
          isSubmitting={isCreatingRun}
          onClose={() => setIsNewRunOpen(false)}
          onSubmit={(params) => createRun(params)}
        />
      )}
    </>
  );
}
