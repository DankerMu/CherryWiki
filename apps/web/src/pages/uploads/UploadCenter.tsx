import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Spin, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { getErrorMessage } from '../../components/adminUi';
import { useUploadPolling } from '../../hooks/useUploadPolling';
import { type ApiMeta, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import FileUploadZone from './FileUploadZone';
import UploadDetail from './UploadDetail';
import UploadList from './UploadList';
import UrlUploadForm from './UrlUploadForm';
import { UPLOAD_PAGE_SIZE, type UploadItem, type UploadResponse, type UploadStatus } from './types';

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: UPLOAD_PAGE_SIZE,
  total: 0,
  has_next: false,
};

export default function UploadCenter() {
  const { t } = useTranslation();
  const { spaceId = '' } = useParams();
  const { accessToken, isAuthenticated } = useAuth();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [page, setPage] = useState(DEFAULT_PAGINATION.page);
  const [statusFilter, setStatusFilter] = useState('');
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<UploadStatus | null>(null);

  const loadUploads = useCallback(
    async (background = false) => {
      if (spaceId.length === 0) {
        setUploads([]);
        setPagination(DEFAULT_PAGINATION);
        setIsLoading(false);
        return;
      }

      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await api.getWrapped<UploadItem[]>(`/spaces/${encodeURIComponent(spaceId)}/uploads`, {
          page,
          per_page: UPLOAD_PAGE_SIZE,
          status: statusFilter,
          sort: '-created_at',
        });
        setUploads(response.data);
        setPagination(
          response.meta?.pagination ?? {
            page,
            per_page: UPLOAD_PAGE_SIZE,
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
    [page, spaceId, statusFilter],
  );

  useEffect(() => {
    void loadUploads();
  }, [loadUploads]);

  useEffect(() => {
    setSelectedUploadId(null);
    setSelectedStatus(null);
    setPage(1);
  }, [spaceId]);

  const mergeStatuses = useCallback((statuses: UploadStatus[]) => {
    setUploads((current) =>
      current.map((upload) => {
        const status = statuses.find((candidate) => candidate.source_document_id === upload.id);
        return status === undefined
          ? upload
          : {
              ...upload,
              status: status.status,
              progress_percent: status.progress_percent,
              job_id: status.job_id,
              job_status: status.job_status,
              error_json: status.error_json,
            };
      }),
    );
    setSelectedStatus((current) => {
      if (current === null) {
        return current;
      }

      return statuses.find((status) => status.source_document_id === current.source_document_id) ?? current;
    });
  }, []);

  useUploadPolling({
    uploads,
    onStatuses: mergeStatuses,
    onError: (err) => setError(getErrorMessage(err)),
  });

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) ?? null,
    [selectedUploadId, uploads],
  );

  const loadUploadStatus = useCallback(async (uploadId: string) => {
    try {
      const status = await api.get<UploadStatus>(`/uploads/${encodeURIComponent(uploadId)}/status`);
      setSelectedStatus(status);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  function addOptimisticUpload(response: UploadResponse, input: { filename: string; sourceType: string; sizeBytes: number | null }): void {
    const now = new Date().toISOString();
    const upload: UploadItem = {
      id: response.source_document_id,
      filename: input.filename,
      mime_type: null,
      sha256: null,
      size_bytes: input.sizeBytes,
      source_type: input.sourceType,
      classification: null,
      status: response.status,
      uploader_id: null,
      space_id: spaceId,
      metadata_json: {},
      created_at: now,
      updated_at: now,
      job_id: response.job_id,
    };

    setUploads((current) => {
      if (statusFilter.length > 0 && statusFilter !== upload.status) {
        return current;
      }

      const withoutDuplicate = current.filter((item) => item.id !== upload.id);
      return [upload, ...withoutDuplicate].slice(0, UPLOAD_PAGE_SIZE);
    });
    setPagination((current) => ({ ...current, total: response.created ? current.total + 1 : current.total }));
    void loadUploads(true);
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>{t('upload.title')}</Typography.Title>
          <Typography.Text type="secondary">{t('upload.description')}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { void loadUploads(); }}>
          {t('common.action.refresh')}
        </Button>
      </div>

      {error !== null && (
        <Alert message={error} type="error" showIcon closable style={{ marginBottom: 16 }} onClose={() => setError(null)} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <FileUploadZone
          spaceId={spaceId}
          accessToken={accessToken}
          onUploaded={(response, file) =>
            addOptimisticUpload(response, {
              filename: file.name,
              sourceType: 'upload',
              sizeBytes: file.size,
            })
          }
        />
        <UrlUploadForm
          spaceId={spaceId}
          onUploaded={(response, url) =>
            addOptimisticUpload(response, {
              filename: url,
              sourceType: 'url',
              sizeBytes: null,
            })
          }
        />
      </div>

      {isLoading ? (
        <Spin tip={t('upload.loading')}><div style={{ minHeight: 200 }} /></Spin>
      ) : (
        <UploadList
          uploads={uploads}
          page={pagination.page}
          total={pagination.total}
          statusFilter={statusFilter}
          onStatusFilterChange={(nextStatus) => {
            setStatusFilter(nextStatus);
            setPage(1);
          }}
          onPageChange={setPage}
          onSelectUpload={(upload) => {
            setSelectedUploadId(upload.id);
            setSelectedStatus(null);
            void loadUploadStatus(upload.id);
          }}
        />
      )}

      <UploadDetail
        open={selectedUpload !== null}
        upload={selectedUpload}
        status={selectedStatus}
        onClose={() => {
          setSelectedUploadId(null);
          setSelectedStatus(null);
        }}
        onReprocessed={(response) => {
          mergeStatuses([
            {
              source_document_id: response.source_document_id,
              status: response.status,
              job_id: response.job_id,
              job_status: null,
              progress_percent: null,
              error_json: null,
            },
          ]);
          void loadUploads(true);
          void loadUploadStatus(response.source_document_id);
        }}
      />
    </>
  );
}
