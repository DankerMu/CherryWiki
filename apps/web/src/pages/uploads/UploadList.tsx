import { EmptyState, formatDate, formatLabel } from '../../components/adminUi';
import {
  UPLOAD_PAGE_SIZE,
  UPLOAD_STATUS_OPTIONS,
  formatFileSize,
  getUploadStatusClass,
  type UploadItem,
} from './types';

type UploadListProps = {
  uploads: UploadItem[];
  page: number;
  total: number;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  onPageChange: (page: number) => void;
  onSelectUpload: (upload: UploadItem) => void;
};

export default function UploadList({
  uploads,
  page,
  total,
  statusFilter,
  onStatusFilterChange,
  onPageChange,
  onSelectUpload,
}: UploadListProps) {
  const totalPages = Math.max(1, Math.ceil(total / UPLOAD_PAGE_SIZE), page);

  return (
    <section className="detail-panel" aria-label="Upload list">
      <div className="detail-panel-header">
        <div>
          <h2>Uploads</h2>
          <p>Track processing state for files and URLs in this space.</p>
        </div>
        <label className="upload-status-filter">
          Status
          <select
            value={statusFilter}
            onChange={(event) => {
              onStatusFilterChange(event.target.value);
            }}
          >
            <option value="">All statuses</option>
            {UPLOAD_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {formatLabel(status)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {uploads.length === 0 ? (
        <EmptyState label="No uploads match the current filters." />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Uploader</th>
                  <th>Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((upload) => (
                  <tr key={upload.id}>
                    <td>
                      <strong>{upload.filename}</strong>
                      <span className="subtle-id">{upload.id}</span>
                    </td>
                    <td>{formatLabel(upload.source_type)}</td>
                    <td>{formatFileSize(upload.size_bytes)}</td>
                    <td>
                      <UploadStatusBadge status={upload.status} />
                    </td>
                    <td>{upload.uploader_id ?? 'Unknown'}</td>
                    <td>{formatDate(upload.created_at)}</td>
                    <td>
                      <button className="button button-secondary" type="button" onClick={() => onSelectUpload(upload)}>
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <span className="pagination-summary">
              Showing {getFirstItemIndex(page, total)}-{getLastItemIndex(page, uploads.length, total)} of {total}
            </span>
            <div className="upload-pagination-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                Previous
              </button>
              <span className="pagination-summary">
                Page {page} of {totalPages}
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function UploadStatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${getUploadStatusClass(status)}`}>{formatLabel(status)}</span>;
}

function getFirstItemIndex(page: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return (page - 1) * UPLOAD_PAGE_SIZE + 1;
}

function getLastItemIndex(page: number, itemCount: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.min(total, getFirstItemIndex(page, total) + itemCount - 1);
}
