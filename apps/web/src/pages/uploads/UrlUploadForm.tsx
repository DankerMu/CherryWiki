import { Alert, Button, Card, Input, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '../../components/adminUi';
import { api } from '../../lib/api';
import type { UploadResponse } from './types';

type UrlUploadFormProps = {
  spaceId: string;
  onUploaded: (response: UploadResponse, url: string) => void;
};

export default function UrlUploadForm({ spaceId, onUploaded }: UrlUploadFormProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitUrl(): Promise<void> {
    const trimmedUrl = url.trim();
    if (!isValidHttpUrl(trimmedUrl)) {
      setError(t('upload.url.invalidUrl'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await api.post<UploadResponse>(`/spaces/${encodeURIComponent(spaceId)}/uploads`, {
        source_type: 'url',
        url: trimmedUrl,
      });
      onUploaded(response, trimmedUrl);
      setUrl('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card
      title={t('upload.url.title')}
      size="small"
      styles={{ body: { padding: 16 } }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t('upload.url.description')}
      </Typography.Paragraph>

      <div style={{ display: 'flex', gap: 8, marginBottom: error !== null ? 12 : 0 }}>
        <Input
          type="url"
          value={url}
          placeholder={t('upload.url.placeholder')}
          onChange={(event) => setUrl(event.target.value)}
          onPressEnter={() => { void submitUrl(); }}
        />
        <Button
          type="primary"
          loading={isSubmitting}
          onClick={() => { void submitUrl(); }}
        >
          {t('upload.url.submit')}
        </Button>
      </div>

      {error !== null && (
        <Alert message={error} type="error" showIcon style={{ marginTop: 8 }} />
      )}
    </Card>
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
