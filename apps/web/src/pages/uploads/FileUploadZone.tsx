import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import ProgressBar from '../../components/ProgressBar';
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
  const [attempts, setAttempts] = useState<UploadAttempt[]>([]);

  const updateAttempt = useCallback((id: string, patch: Partial<UploadAttempt>) => {
    setAttempts((current) => current.map((attempt) => (attempt.id === id ? { ...attempt, ...patch } : attempt)));
  }, []);

  const uploadFiles = useCallback(
    (files: File[]) => {
      const nextUploads = files.map((file) => ({
        file,
        attempt: validateFileAttempt(file, createFileAttemptKey(file)),
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
    [accessToken, onUploaded, spaceId, updateAttempt],
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      uploadFiles(acceptedFiles);
    },
    [uploadFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: true,
    noKeyboard: false,
    onDrop,
  });

  return (
    <section className="detail-panel upload-panel" aria-label="File upload">
      <div className="detail-panel-header">
        <div>
          <h2>Files</h2>
          <p>Drop files here or choose them from disk.</p>
        </div>
      </div>

      <div
        {...getRootProps({
          className: isDragActive ? 'upload-dropzone active' : 'upload-dropzone',
        })}
      >
        <input {...getInputProps({ 'aria-label': 'Choose files for upload' })} />
        <strong>{isDragActive ? 'Release to upload' : 'Drop files or click to select'}</strong>
        <span>
          Supported: {SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}. Limit: {formatFileSize(MAX_UPLOAD_SIZE_BYTES)} per
          file.
        </span>
      </div>

      {attempts.length > 0 ? (
        <div className="upload-attempt-list" aria-label="Upload results">
          {attempts.map((attempt) => (
            <article className="upload-attempt" key={attempt.id}>
              <div className="upload-attempt-header">
                <div>
                  <strong>{attempt.filename}</strong>
                  <span>{formatFileSize(attempt.sizeBytes)}</span>
                </div>
                {renderAttemptState(attempt)}
              </div>
              {attempt.status === 'uploading' ? (
                <ProgressBar percent={attempt.progress} stage="Uploading" size="sm" />
              ) : null}
              {attempt.status === 'success' && attempt.sourceDocumentId !== undefined ? (
                <p className="upload-result upload-result-success">✓ source_document_id: {attempt.sourceDocumentId}</p>
              ) : null}
              {attempt.status === 'error' ? (
                <p className="upload-result upload-result-error" role="alert">
                  <strong>{attempt.errorCode ?? 'UPLOAD_ERROR'}</strong>: {attempt.errorMessage ?? 'Upload failed'}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function validateFileAttempt(file: File, id: string): UploadAttempt {
  if (!isSupportedUploadFile(file.name)) {
    return {
      id,
      filename: file.name,
      sizeBytes: file.size,
      status: 'error',
      progress: 0,
      errorCode: 'UNSUPPORTED_FILE_TYPE',
      errorMessage: 'Unsupported file type.',
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
      errorMessage: 'File exceeds the 200 MB upload limit.',
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

function renderAttemptState(attempt: UploadAttempt) {
  if (attempt.status === 'success') {
    return <span className="upload-state upload-state-success">Uploaded</span>;
  }

  if (attempt.status === 'error') {
    return <span className="upload-state upload-state-error">Failed</span>;
  }

  if (attempt.status === 'uploading') {
    return <span className="upload-state upload-state-info">Uploading</span>;
  }

  return <span className="upload-state upload-state-info">Queued</span>;
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
