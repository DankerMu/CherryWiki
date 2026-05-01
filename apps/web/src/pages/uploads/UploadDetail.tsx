import { useState } from 'react';
import ProgressBar from '../../components/ProgressBar';
import { ErrorBanner, formatDate, formatLabel, getErrorMessage } from '../../components/adminUi';
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
  upload: UploadItem;
  status: UploadStatus | null;
  onClose: () => void;
  onReprocessed: (response: UploadResponse) => void;
};

export default function UploadDetail({ upload, status, onClose, onReprocessed }: UploadDetailProps) {
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeStatus = status?.status ?? upload.status;
  const failureDetails = readUploadFailureDetails(status, upload);
  const showFailureDetails =
    activeStatus === 'parse_failed' || activeStatus === 'security_rejected' || failureDetails.errorMessage !== null;

  async function reprocessUpload(): Promise<void> {
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

  return (
    <div className="upload-drawer-backdrop" role="presentation">
      <aside className="upload-drawer" role="dialog" aria-modal="true" aria-label="Upload detail">
        <div className="modal-header">
          <div>
            <h2>Upload Detail</h2>
            <p className="muted-copy">{upload.filename}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>
            x
          </button>
        </div>

        <ErrorBanner error={error} />

        <section className="detail-panel upload-detail-section" aria-label="Upload overview">
          <div className="detail-panel-header">
            <div>
              <h2>{upload.filename}</h2>
              <p>{upload.id}</p>
            </div>
            <UploadStatusBadge status={activeStatus} />
          </div>

          <ProgressBar
            percent={getUploadProgressPercent(upload, status)}
            stage={getUploadStageLabel(upload, status)}
            size="md"
          />

          <div className="settings-grid">
            <div>
              <span className="eyebrow">Source Document ID</span>
              <code>{upload.id}</code>
            </div>
            <div>
              <span className="eyebrow">Type</span>
              <span className="job-meta-value">{formatLabel(upload.source_type)}</span>
            </div>
            <div>
              <span className="eyebrow">Size</span>
              <span className="job-meta-value">{formatFileSize(upload.size_bytes)}</span>
            </div>
            <div>
              <span className="eyebrow">Uploader</span>
              <span className="job-meta-value">{upload.uploader_id ?? 'Unknown'}</span>
            </div>
            <div>
              <span className="eyebrow">MIME</span>
              <span className="job-meta-value">{upload.mime_type ?? 'Unknown'}</span>
            </div>
            <div>
              <span className="eyebrow">SHA256</span>
              <span className="job-meta-value">{upload.sha256 ?? 'Pending'}</span>
            </div>
            <div>
              <span className="eyebrow">Created</span>
              <span className="job-meta-value">{formatDate(upload.created_at)}</span>
            </div>
            <div>
              <span className="eyebrow">Updated</span>
              <span className="job-meta-value">{formatDate(upload.updated_at)}</span>
            </div>
            <div>
              <span className="eyebrow">Job ID</span>
              <span className="job-meta-value">{status?.job_id ?? upload.job_id ?? 'None'}</span>
            </div>
            <div>
              <span className="eyebrow">Job Status</span>
              <span className="job-meta-value">{status?.job_status ?? upload.job_status ?? 'None'}</span>
            </div>
          </div>
        </section>

        {showFailureDetails ? (
          <section className="detail-panel upload-detail-section" aria-label="Failure details">
            <div className="detail-panel-header">
              <div>
                <h2>Failure Details</h2>
                <p>Parser or security validation details returned by the processing job.</p>
              </div>
            </div>
            <div className="settings-grid">
              <div>
                <span className="eyebrow">Error Type</span>
                <span className="job-meta-value">{failureDetails.errorType ?? 'Unknown'}</span>
              </div>
              <div>
                <span className="eyebrow">Error Message</span>
                <span className="job-meta-value">{failureDetails.errorMessage ?? 'No error message recorded'}</span>
              </div>
            </div>
          </section>
        ) : null}

        <section className="detail-panel upload-detail-section" aria-label="Metadata">
          <div className="detail-panel-header">
            <div>
              <h2>Metadata</h2>
              <p>Raw upload metadata captured by the API.</p>
            </div>
          </div>
          <pre className="upload-metadata-json">{JSON.stringify(upload.metadata_json ?? {}, null, 2)}</pre>
        </section>

        {activeStatus === 'parse_failed' ? (
          <div className="form-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={isReprocessing}
              onClick={() => {
                void reprocessUpload();
              }}
            >
              {isReprocessing ? 'Reprocessing...' : 'Reprocess'}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
