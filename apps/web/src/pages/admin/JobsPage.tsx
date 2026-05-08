import { ReloadOutlined } from '@ant-design/icons';
import { Button, Input, Progress, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { type ApiMeta, api } from '../../lib/api';
import { formatDate, formatLabel, getErrorMessage } from '../../components/adminUi';
import {
  ADMIN_JOB_STATUS_OPTIONS,
  ADMIN_JOB_TYPE_FILTER_OPTIONS,
  type AdminJob,
  getDisplayStatus,
} from '../../lib/adminTypes';

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: 20,
  total: 0,
  has_next: false,
};

const JOB_POLL_INTERVAL_MS = 5_000;

function jobStatusColor(status: string): string {
  if (status === 'succeeded') return 'green';
  if (status === 'running') return 'blue';
  if (status === 'failed') return 'red';
  if (status === 'cancelled' || status === 'cancelling') return 'default';
  return 'orange';
}

function JobsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const deferredSpaceId = useDeferredValue(spaceId);
  const [page, setPage] = useState(DEFAULT_PAGINATION.page);
  const [perPage, setPerPage] = useState(DEFAULT_PAGINATION.per_page);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);

  const loadJobs = useCallback(
    async (background = false) => {
      if (!background) setIsLoading(true);

      try {
        const response = await api.getWrapped<AdminJob[]>('/admin/jobs', {
          type,
          status,
          space_id: deferredSpaceId,
          page,
          per_page: perPage,
          sort: '-created_at',
        });
        setJobs(response.data);
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
    [deferredSpaceId, page, perPage, status, type],
  );

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const shouldPoll = status === 'running' || jobs.some((job) => job.status === 'running');

  useEffect(() => {
    if (!shouldPoll) return;

    const intervalId = window.setInterval(() => {
      void loadJobs(true);
    }, JOB_POLL_INTERVAL_MS);

    return () => { window.clearInterval(intervalId); };
  }, [loadJobs, shouldPoll]);

  const columns: ColumnsType<AdminJob> = [
    {
      title: t('admin.jobs.columns.type'),
      key: 'type',
      render: (_: unknown, job: AdminJob) => (
        <div>
          <Typography.Text strong>{formatLabel(job.type)}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{job.job_id}</Typography.Text>
        </div>
      ),
    },
    {
      title: t('admin.jobs.columns.status'),
      key: 'status',
      render: (_: unknown, job: AdminJob) => {
        const displayStatus = getDisplayStatus(job);
        return <Tag color={jobStatusColor(displayStatus)}>{t(`common.status.${displayStatus}`, displayStatus)}</Tag>;
      },
    },
    {
      title: t('admin.jobs.columns.space'),
      dataIndex: 'space_id',
      key: 'space_id',
      render: (val: string | null) => val ?? t('common.state.global'),
    },
    {
      title: t('admin.jobs.columns.progress'),
      key: 'progress',
      render: (_: unknown, job: AdminJob) => {
        if (job.progress !== null || job.status === 'running' || job.status === 'succeeded') {
          const percent = job.progress?.percent ?? (job.status === 'succeeded' ? 100 : 0);
          const stage = job.progress?.stage ?? getFallbackProgressStage(job.status, t);
          return (
            <div style={{ minWidth: 120 }}>
              <Progress percent={Math.round(percent)} size="small" {...(job.status === 'failed' ? { status: 'exception' as const } : {})} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{stage}</Typography.Text>
            </div>
          );
        }
        return <Typography.Text type="secondary">{formatLabel(job.status)}</Typography.Text>;
      },
    },
    {
      title: t('admin.jobs.columns.created'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => formatDate(val),
      sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
    {
      title: t('admin.jobs.columns.duration'),
      key: 'duration',
      render: (_: unknown, job: AdminJob) => formatJobDuration(job, t),
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.jobs.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.jobs.description')}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { void loadJobs(); }}>
          {t('common.action.refresh')}
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          value={type || undefined}
          onChange={(val) => { setType(val ?? ''); setPage(1); }}
          placeholder={t('admin.jobs.filter.allTypes')}
          allowClear
          style={{ width: 160 }}
        >
          {ADMIN_JOB_TYPE_FILTER_OPTIONS.map((jobType) => (
            <Select.Option key={jobType} value={jobType}>{formatLabel(jobType)}</Select.Option>
          ))}
        </Select>
        <Select
          value={status || undefined}
          onChange={(val) => { setStatus(val ?? ''); setPage(1); }}
          placeholder={t('admin.jobs.filter.allStatuses')}
          allowClear
          style={{ width: 160 }}
        >
          {ADMIN_JOB_STATUS_OPTIONS.map((jobStatus) => (
            <Select.Option key={jobStatus} value={jobStatus}>{formatLabel(jobStatus)}</Select.Option>
          ))}
        </Select>
        <Input.Search
          placeholder={t('admin.jobs.filter.spacePlaceholder')}
          value={spaceId}
          onChange={(e) => { setSpaceId(e.target.value); setPage(1); }}
          allowClear
          style={{ width: 200 }}
        />
      </Space>

      <Table<AdminJob>
        columns={columns}
        dataSource={jobs}
        rowKey="job_id"
        loading={isLoading}
        onRow={(job) => ({
          onClick: () => { void navigate(`/admin/jobs/${job.job_id}`); },
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize: perPage,
          total: pagination.total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (p, ps) => { setPage(p); setPerPage(ps); },
          showTotal: (total, range) => t('admin.jobs.pagination.showing', { from: range[0], to: range[1], total }),
        }}
        locale={{ emptyText: t('admin.jobs.emptyFilter') }}
        size="middle"
      />
    </>
  );
}

export default requireAdminPage(JobsPage);

function getFallbackProgressStage(status: string, t: (key: string) => string): string {
  if (status === 'running') return t('admin.jobs.progress.running');
  if (status === 'succeeded') return t('admin.jobs.progress.completed');
  return formatLabel(status);
}

function formatJobDuration(job: AdminJob, t: (key: string) => string): string {
  if (job.started_at === null) {
    return job.status === 'pending' ? t('admin.jobs.duration.queued') : t('admin.jobs.duration.notStarted');
  }

  const startedAt = parseTimestamp(job.started_at);
  if (startedAt === null) return t('admin.jobs.duration.unavailable');

  const completedAt =
    job.completed_at !== null ? parseTimestamp(job.completed_at) : job.status === 'running' ? Date.now() : null;

  if (completedAt === null) return t('admin.jobs.duration.inProgress');

  return formatElapsedTime(completedAt - startedAt);
}

function parseTimestamp(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatElapsedTime(durationMs: number): string {
  if (durationMs < 1_000) return '<1s';

  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
