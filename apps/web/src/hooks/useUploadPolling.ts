import { useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { isUploadProcessing, type UploadItem, type UploadStatus } from '../pages/uploads/types';

const DEFAULT_UPLOAD_POLL_INTERVAL_MS = 5_000;

export function useUploadPolling({
  uploads,
  onStatuses,
  onError,
  intervalMs = DEFAULT_UPLOAD_POLL_INTERVAL_MS,
}: {
  uploads: UploadItem[];
  onStatuses: (statuses: UploadStatus[]) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
}) {
  const processingIds = useMemo(
    () => uploads.filter((upload) => isUploadProcessing(upload.status)).map((upload) => upload.id),
    [uploads],
  );
  const processingKey = processingIds.join('|');

  useEffect(() => {
    if (processingIds.length === 0) {
      return;
    }

    let isCancelled = false;

    async function pollStatuses(): Promise<void> {
      try {
        const statuses = await Promise.all(
          processingIds.map((id) => api.get<UploadStatus>(`/uploads/${encodeURIComponent(id)}/status`)),
        );
        if (!isCancelled) {
          onStatuses(statuses);
        }
      } catch (err) {
        if (!isCancelled) {
          onError?.(err);
        }
      }
    }

    const intervalId = window.setInterval(() => {
      void pollStatuses();
    }, intervalMs);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [intervalMs, onError, onStatuses, processingIds, processingKey]);
}
