import { type FormEvent, useState } from 'react';
import { ErrorBanner, getErrorMessage } from '../../components/adminUi';
import { api } from '../../lib/api';
import type { UploadResponse } from './types';

type UrlUploadFormProps = {
  spaceId: string;
  onUploaded: (response: UploadResponse, url: string) => void;
};

export default function UrlUploadForm({ spaceId, onUploaded }: UrlUploadFormProps) {
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function submitUrl(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedUrl = url.trim();
    if (!isValidHttpUrl(trimmedUrl)) {
      setError('Enter a valid http or https URL.');
      setSuccessMessage(null);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await api.post<UploadResponse>(`/spaces/${encodeURIComponent(spaceId)}/uploads`, {
        source_type: 'url',
        url: trimmedUrl,
      });
      onUploaded(response, trimmedUrl);
      setUrl('');
      setSuccessMessage(`Added source_document_id: ${response.source_document_id}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="detail-panel upload-panel" aria-label="URL upload">
      <div className="detail-panel-header">
        <div>
          <h2>URL</h2>
          <p>Add a web source to fetch and process for this space.</p>
        </div>
      </div>

      <form className="url-upload-form" noValidate onSubmit={(event) => void submitUrl(event)}>
        <label>
          URL
          <input
            type="url"
            value={url}
            placeholder="https://example.com/article"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button className="button button-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Adding...' : 'Add URL'}
        </button>
      </form>

      <ErrorBanner error={error} />
      {successMessage !== null ? (
        <p className="upload-result upload-result-success" role="status">
          {successMessage}
        </p>
      ) : null}
    </section>
  );
}

function isValidHttpUrl(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
