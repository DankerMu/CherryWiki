import { ArrowLeftOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { requireAdminPage } from '../../components/RequireAdminPage';
import { api } from '../../lib/api';
import { formatDate, formatLabel, getErrorMessage } from '../../components/adminUi';
import { type AdminJob, type CancelJobResponse, type JobEvent, getDisplayStatus } from '../../lib/adminTypes';

const JOB_REFRESH_INTERVAL_MS = 5_000;

function jobStatusColor(status: string): string {
  if (status === 'succeeded') return 'green';
  if (status === 'running') return 'blue';
  if (status === 'failed') return 'red';
  if (status === 'cancelled' || status === 'cancelling') return 'default';
  return 'orange';
}

function timelineColor(event: string): string {
  if (event.includes('fail') || event.includes('error')) return 'red';
  if (event.includes('complete') || event.includes('succeed')) return 'green';
  if (event.includes('start') || event.includes('running')) return 'blue';
  return 'gray';
}

function JobDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { jobId = '' } = useParams();
  const [job, setJob] = useState<AdminJob | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);

  const loadJobDetail = useCallback(
    async (background = false) => {
      if (jobId.length === 0) {
        setJob(null);
        setEvents([]);
        setIsLoading(false);
        return;
      }

      if (!background) setIsLoading(true);

      try {
        const [jobResponse, eventResponse] = await Promise.all([
          api.get<AdminJob>(`/jobs/${jobId}`),
          api.get<JobEvent[]>(`/jobs/${jobId}/events`, { limit: 100, offset: 0 }),
        ]);
        setJob(jobResponse);
        setEvents(eventResponse);
      } catch (err) {
        void message.error(getErrorMessage(err));
      } finally {
        if (!background) setIsLoading(false);
      }
    },
    [jobId],
  );

  useEffect(() => {
    void loadJobDetail();
  }, [loadJobDetail]);

  useEffect(() => {
    if (job?.status !== 'running') return;

    const intervalId = window.setInterval(() => {
      void loadJobDetail(true);
    }, JOB_REFRESH_INTERVAL_MS);

    return () => { window.clearInterval(intervalId); };
  }, [job?.status, loadJobDetail]);

  async function cancelJob(): Promise<void> {
    if (job === null) return;

    setIsCancelling(true);

    try {
      const response = await api.post<CancelJobResponse>(`/jobs/${job.job_id}/cancel`);
      setJob((current) =>
        current === null
          ? current
          : { ...current, status: response.status, cancel_requested_at: response.cancel_requested_at },
      );
      await loadJobDetail(true);
    } catch (err) {
      void message.error(getErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  }

  const showCancelButton = job !== null && (job.status === 'pending' || job.status === 'running');
  const isCancellationPending = job !== null && job.status === 'running' && job.cancel_requested_at !== null;
  const cancelButtonLabel = isCancellationPending || isCancelling ? t('admin.jobDetail.cancelling') : t('admin.jobDetail.cancelJob');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('admin.jobDetail.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('admin.jobDetail.description')}</Typography.Text>
        </div>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => { void navigate('/admin/jobs'); }}>
            {t('admin.jobDetail.backToJobs')}
          </Button>
          {showCancelButton ? (
            <Popconfirm
              title={t('admin.jobDetail.confirmCancel')}
              onConfirm={() => { void cancelJob(); }}
              okText={t('common.action.confirm')}
              cancelText={t('common.action.cancel')}
            >
              <Button danger loading={isCancelling} disabled={isCancellationPending}>
                {cancelButtonLabel}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" tip={t('admin.jobDetail.loading')} /></div>
      ) : job === null ? (
        <Empty description={t('admin.jobDetail.unavailable')} />
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {job.display_name ?? formatLabel(job.type)}
            </Typography.Title>
            <Typography.Text type="secondary">
              {job.display_name ? `${formatLabel(job.type)} · ${job.job_id}` : job.job_id}
            </Typography.Text>
          </div>
          <Card title={t('admin.jobDetail.overview.title')} style={{ marginBottom: 16 }}>
            {job.progress?.percent !== undefined ? (
              <Progress
                percent={Math.round(job.progress.percent)}
                status={job.status === 'failed' ? 'exception' : job.status === 'succeeded' ? 'success' : 'active'}
                style={{ marginBottom: 16 }}
              />
            ) : null}

            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
              <Descriptions.Item label={t('admin.jobDetail.overview.jobId')}>
                <Typography.Text code>{job.job_id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.jobDetail.overview.type')}>
                {formatLabel(job.type)}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.jobDetail.overview.status')}>
                <Tag color={jobStatusColor(getDisplayStatus(job))}>{t(`common.status.${getDisplayStatus(job)}`, getDisplayStatus(job))}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.jobDetail.overview.space')}>
                {job.space_id ?? t('common.state.global')}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.jobDetail.overview.createdBy')}>
                {job.created_by ?? t('common.state.system')}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.jobDetail.overview.createdAt')}>
                {formatDate(job.created_at)}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.jobDetail.overview.startedAt')}>
                {formatDate(job.started_at)}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.jobDetail.overview.completedAt')}>
                {formatDate(job.completed_at)}
              </Descriptions.Item>
              {job.cancel_requested_at !== null ? (
                <Descriptions.Item label={t('admin.jobDetail.overview.cancelRequestedAt')}>
                  {formatDate(job.cancel_requested_at)}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </Card>

          <Card title={t('admin.jobDetail.data.title')} style={{ marginBottom: 16 }}>
            <Typography.Paragraph type="secondary">{t('admin.jobDetail.data.description')}</Typography.Paragraph>
            <Typography.Title level={5}>{t('admin.jobDetail.data.payload')}</Typography.Title>
            <pre style={{ background: 'var(--ant-color-bg-layout)', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 300 }}>
              {formatJson(job.payload_json)}
            </pre>
            <Typography.Title level={5}>{t('admin.jobDetail.data.result')}</Typography.Title>
            <pre style={{ background: 'var(--ant-color-bg-layout)', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 300 }}>
              {formatJson(job.result_json)}
            </pre>
            <Typography.Title level={5}>{t('admin.jobDetail.data.error')}</Typography.Title>
            <pre style={{ background: 'var(--ant-color-bg-layout)', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 300 }}>
              {formatJson(job.error_json)}
            </pre>
          </Card>

          <Card title={t('admin.jobDetail.events.title')}>
            <Typography.Paragraph type="secondary">{t('admin.jobDetail.events.description')}</Typography.Paragraph>
            {events.length === 0 ? (
              <Empty description={t('admin.jobDetail.events.empty')} />
            ) : (
              <Timeline
                items={events.map((event, index) => ({
                  key: `${event.timestamp}-${event.event}-${index}`,
                  color: timelineColor(event.event),
                  children: (
                    <div>
                      <Space>
                        <Typography.Text strong>{formatLabel(event.event)}</Typography.Text>
                        <Typography.Text type="secondary">{formatDate(event.timestamp)}</Typography.Text>
                      </Space>
                      <pre style={{ background: 'var(--ant-color-bg-layout)', padding: 8, borderRadius: 4, marginTop: 4, fontSize: 12, overflow: 'auto', maxHeight: 200 }}>
                        {formatJson(event.detail)}
                      </pre>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </>
      )}
    </>
  );
}

export default requireAdminPage(JobDetailPage);

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}
