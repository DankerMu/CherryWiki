import { Alert, Button, Descriptions, Drawer, Progress, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatLabel, getErrorMessage } from '../../components/adminUi';
import { api } from '../../lib/api';
import {
  formatFileSize,
  getUploadProgressPercent,
  getUploadStageLabel,
  readUploadFailureDetails,
  type UploadItem,
  type UploadResponse,
  type UploadStatus,
} from './types';
import { UploadStatusBadge } from './UploadList';

type UploadDetailProps = {
  open: boolean;
  upload: UploadItem | null;
  status: UploadStatus | null;
  canReprocess: boolean;
  onClose: () => void;
  onReprocessed: (response: UploadResponse) => void;
};

export default function UploadDetail({ open, upload, status, canReprocess, onClose, onReprocessed }: UploadDetailProps) {
  const { t } = useTranslation();
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (upload === null) {
    return <Drawer open={open} onClose={onClose} title={t('upload.detail.title')} width={560} />;
  }

  const activeStatus = status?.status ?? upload.status;
  const failureDetails = readUploadFailureDetails(status, upload);
  const showFailureDetails =
    activeStatus === 'parse_failed' || activeStatus === 'security_rejected' || failureDetails.errorMessage !== null;

  async function reprocessUpload(): Promise<void> {
    if (upload === null) return;
    if (!canReprocess) return;

    setIsReprocessing(true);
    setError(null);

    try {
      const response = await api.post<UploadResponse>(`/uploads/${encodeURIComponent(upload.id)}/reprocess`);
      onReprocessed(response);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsReprocessing(false);
    }
  }

  const progressPercent = getUploadProgressPercent(upload, status);
  const progressStage = getUploadStageLabel(upload, status);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('upload.detail.title')}
      width={560}
      extra={<UploadStatusBadge status={activeStatus} />}
    >
      {error !== null && (
        <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      <Typography.Title level={5}>{upload.filename}</Typography.Title>

      <div style={{ marginBottom: 16 }}>
        <Progress
          percent={Math.round(progressPercent)}
          size="small"
          {...(activeStatus === 'parse_failed' || activeStatus === 'security_rejected' ? { status: 'exception' as const } : {})}
        />
        <Typography.Text type="secondary">{progressStage}</Typography.Text>
      </div>

      <Descriptions column={2} bordered size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t('upload.detail.sourceDocId')}><Typography.Text copyable>{upload.id}</Typography.Text></Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.type')}>{formatLabel(upload.source_type)}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.size')}>{formatFileSize(upload.size_bytes)}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.uploader')}>{upload.uploader_id ?? t('upload.detail.unknown')}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.mime')}>{upload.mime_type ?? t('upload.detail.unknown')}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.sha256')}>{upload.sha256 ?? t('upload.detail.pending')}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.created')}>{formatDate(upload.created_at)}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.updated')}>{formatDate(upload.updated_at)}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.jobId')}>{status?.job_id ?? upload.job_id ?? t('upload.detail.none')}</Descriptions.Item>
        <Descriptions.Item label={t('upload.detail.jobStatus')}>{status?.job_status ?? upload.job_status ?? t('upload.detail.none')}</Descriptions.Item>
      </Descriptions>

      {showFailureDetails && (
        <>
          <Typography.Title level={5}>{t('upload.detail.failure.title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('upload.detail.failure.description')}</Typography.Paragraph>
          <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label={t('upload.detail.failure.errorType')}>
              {failureDetails.errorType ?? t('upload.detail.unknown')}
            </Descriptions.Item>
            <Descriptions.Item label={t('upload.detail.failure.errorMessage')}>
              {failureDetails.errorMessage ?? t('upload.detail.failure.noErrorMessage')}
            </Descriptions.Item>
          </Descriptions>
        </>
      )}

      <Typography.Title level={5}>{t('upload.detail.metadata.title')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('upload.detail.metadata.description')}</Typography.Paragraph>
      <pre style={{ background: 'var(--ant-color-fill-quaternary, #fafafa)', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 200, fontSize: 12 }}>
        {JSON.stringify(upload.metadata_json ?? {}, null, 2)}
      </pre>

      {activeStatus === 'parse_failed' && canReprocess && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button
            type="primary"
            loading={isReprocessing}
            onClick={() => { void reprocessUpload(); }}
          >
            {t('upload.detail.reprocess')}
          </Button>
        </div>
      )}
    </Drawer>
  );
}
