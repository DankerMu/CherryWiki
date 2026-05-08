import { InboxOutlined } from '@ant-design/icons';
import { Card, Progress, Tag, Typography, Upload } from 'antd';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_UPLOAD_SIZE_BYTES,
  SUPPORTED_UPLOAD_EXTENSIONS,
  formatFileSize,
  getUploadErrorCode,
  getUploadErrorMessage,
  isSupportedUploadFile,
  readApiErrorBody,
  unwrapApiBody,
  type UploadResponse,
} from './types';

type UploadAttemptStatus = 'queued' | 'uploading' | 'success' | 'error';

type UploadAttempt = {
  id: string;
  filename: string;
  sizeBytes: number;
  status: UploadAttemptStatus;
  progress: number;
  sourceDocumentId?: string;
  errorCode?: string;
  errorMessage?: string;
};

type FileUploadZoneProps = {
  spaceId: string;
  accessToken: string | null;
  onUploaded: (response: UploadResponse, file: File) => void;
};

let uploadAttemptCounter = 0;

export default function FileUploadZone({ spaceId, accessToken, onUploaded }: FileUploadZoneProps) {
  const { t } = useTranslation();
  const [attempts, setAttempts] = useState<UploadAttempt[]>([]);

  const updateAttempt = useCallback((id: string, patch: Partial<UploadAttempt>) => {
    setAttempts((current) => current.map((attempt) => (attempt.id === id ? { ...attempt, ...patch } : attempt)));
  }, []);

  const uploadFiles = useCallback(
    (files: File[]) => {
      const nextUploads = files.map((file) => ({
        file,
        attempt: validateFileAttempt(file, createFileAttemptKey(file), t),
      }));
      setAttempts((current) => [...nextUploads.map((upload) => upload.attempt), ...current]);

      for (const { attempt, file } of nextUploads) {
        if (attempt.status === 'error') {
          continue;
        }

        updateAttempt(attempt.id, { status: 'uploading', progress: 0 });
        void uploadFile({
          spaceId,
          accessToken,
          file,
          onProgress: (progress) => updateAttempt(attempt.id, { progress }),
        })
          .then((response) => {
            updateAttempt(attempt.id, {
              status: 'success',
              progress: 100,
              sourceDocumentId: response.source_document_id,
            });
            onUploaded(response, file);
          })
          .catch((err: unknown) => {
            updateAttempt(attempt.id, {
              status: 'error',
              errorCode: getUploadErrorCode(err),
              errorMessage: getUploadErrorMessage(err),
            });
          });
      }
    },
    [accessToken, onUploaded, spaceId, t, updateAttempt],
  );

  function handleBeforeUpload(file: File, fileList: File[]): false {
    // Only trigger once for a batch by checking if this is the last file
    if (file === fileList[fileList.length - 1]) {
      uploadFiles(fileList);
    }
    return false;
  }

  return (
    <Card
      title={t('upload.file.title')}
      size="small"
      styles={{ body: { padding: 16 } }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t('upload.file.description')}
      </Typography.Paragraph>

      <Upload.Dragger
        multiple
        showUploadList={false}
        beforeUpload={handleBeforeUpload}
        style={{ marginBottom: attempts.length > 0 ? 16 : 0 }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{t('upload.file.dropIdle')}</p>
        <p className="ant-upload-hint">
          {t('upload.file.supported', {
            extensions: SUPPORTED_UPLOAD_EXTENSIONS.join(', '),
            limit: formatFileSize(MAX_UPLOAD_SIZE_BYTES),
          })}
        </p>
      </Upload.Dragger>

      {attempts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {attempts.map((attempt) => (
            <div key={attempt.id} style={{ marginBottom: 8, padding: '8px 0', borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div>
                  <Typography.Text strong>{attempt.filename}</Typography.Text>
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>{formatFileSize(attempt.sizeBytes)}</Typography.Text>
                </div>
                <AttemptTag status={attempt.status} />
              </div>
              {attempt.status === 'uploading' && (
                <Progress percent={attempt.progress} size="small" />
              )}
              {attempt.status === 'success' && attempt.sourceDocumentId !== undefined && (
                <Typography.Text type="success">source_document_id: {attempt.sourceDocumentId}</Typography.Text>
              )}
              {attempt.status === 'error' && (
                <Typography.Text type="danger">
                  <strong>{attempt.errorCode ?? 'UPLOAD_ERROR'}</strong>: {attempt.errorMessage ?? t('upload.attempt.uploadError')}
                </Typography.Text>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AttemptTag({ status }: { status: UploadAttemptStatus }) {
  const { t } = useTranslation();
  const map: Record<UploadAttemptStatus, { color: string; label: string }> = {
    success: { color: 'green', label: t('upload.attempt.uploaded') },
    error: { color: 'red', label: t('upload.attempt.failed') },
    uploading: { color: 'blue', label: t('upload.attempt.uploading') },
    queued: { color: 'orange', label: t('upload.attempt.queued') },
  };
  const entry = map[status];
  return <Tag color={entry.color}>{entry.label}</Tag>;
}

function validateFileAttempt(file: File, id: string, t: (key: string) => string): UploadAttempt {
  if (!isSupportedUploadFile(file.name)) {
    return {
      id,
      filename: file.name,
      sizeBytes: file.size,
      status: 'error',
      progress: 0,
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      errorMessage: t('upload.attempt.unsupportedType'),
    };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      id,
      filename: file.name,
      sizeBytes: file.size,
      status: 'error',
      progress: 0,
      errorCode: 'FILE_TOO_LARGE',
      errorMessage: t('upload.attempt.fileTooLarge'),
    };
  }

  return {
    id,
    filename: file.name,
    sizeBytes: file.size,
    status: 'queued',
    progress: 0,
  };
}

function createFileAttemptKey(file: File): string {
  uploadAttemptCounter += 1;
  return `${file.name}-${file.size}-${file.lastModified}-${uploadAttemptCounter}`;
}

function uploadFile({
  spaceId,
  accessToken,
  file,
  onProgress,
}: {
  spaceId: string;
  accessToken: string | null;
  file: File;
  onProgress: (progress: number) => void;
}): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('source_type', 'upload');
    formData.append('file', file);

    xhr.open('POST', `/api/spaces/${encodeURIComponent(spaceId)}/uploads`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    if (accessToken !== null && accessToken.length > 0) {
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const body = parseResponseBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(unwrapApiBody<UploadResponse>(body));
        return;
      }

      reject(new UploadRequestError(readApiErrorBody(body)));
    };

    xhr.onerror = () => {
      reject(new UploadRequestError({ code: 'NETWORK_ERROR', message: 'Network error while uploading file.' }));
    };

    xhr.send(formData);
  });
}

function parseResponseBody(value: string): unknown {
  if (value.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

class UploadRequestError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string }) {
    super(input.message);
    this.name = 'UploadRequestError';
    this.code = input.code;
  }
}
