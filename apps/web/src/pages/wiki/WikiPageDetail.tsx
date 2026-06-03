import { ArrowLeftOutlined, HistoryOutlined } from '@ant-design/icons';
import { Alert, Button, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import TiptapRenderer from '../../components/TiptapRenderer';
import { formatDate, getErrorMessage } from '../../components/adminUi';
import { useSpacePermissionGate } from '../../components/SpacePermissionGate';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { wikiApi, type WikiPage, type WikiPageContent } from '../../lib/wikiApi';
import NotFound from '../NotFound';
import { WikiStatusBadge } from './wikiUi';

type WikiPageDetailProps = {
  spaceId: string;
  pageId: string;
  versionId?: string;
};

export default function WikiPageDetail({ spaceId, pageId, versionId }: WikiPageDetailProps) {
  const { t } = useTranslation();
  const { hasSpacePermission } = useAuth();
  const gate = useSpacePermissionGate('space:view', spaceId);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [content, setContent] = useState<WikiPageContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async () => {
    setIsLoading(true);
    setNotFound(false);
    setError(null);

    if (!gate.isAllowed) {
      setIsLoading(false);
      return;
    }

    try {
      const [pageResponse, contentResponse] = await Promise.all([
        wikiApi.getPage(spaceId, pageId),
        wikiApi.getContent(spaceId, pageId, versionId),
      ]);
      setPage(pageResponse.data);
      setContent(contentResponse.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setIsLoading(false);
    }
  }, [gate.isAllowed, pageId, spaceId, versionId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  async function publishCurrentVersion(): Promise<void> {
    if (page?.current_version_id === null || page?.current_version_id === undefined || !gate.isAllowed) {
      return;
    }

    setIsPublishing(true);
    setError(null);

    try {
      await wikiApi.publish(spaceId, pageId, page.current_version_id);
      await loadPage();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsPublishing(false);
    }
  }

  async function unpublishCurrentVersion(): Promise<void> {
    if (page?.current_version_id === null || page?.current_version_id === undefined || !gate.isAllowed) {
      return;
    }

    setIsUnpublishing(true);
    setError(null);

    try {
      await wikiApi.unpublish(spaceId, pageId, page.current_version_id);
      await loadPage();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsUnpublishing(false);
    }
  }

  if (notFound) {
    return <NotFound />;
  }

  const canPublish =
    page !== null &&
    page.status === 'draft' &&
    page.current_version_id !== null &&
    hasSpacePermission(spaceId, 'wiki:publish');

  const canUnpublish =
    page !== null &&
    page.status === 'published' &&
    page.current_version_id !== null &&
    hasSpacePermission(spaceId, 'wiki:publish');

  const statusDescription =
    page !== null
      ? page.status === 'draft'
        ? t('wiki.detail.statusDraft')
        : page.status === 'published'
          ? t('wiki.detail.statusPublished')
          : t('wiki.detail.statusArchived')
      : '';

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {page?.title ?? t('wiki.detail.title')}
          </Typography.Title>
          {page !== null && (
            <Typography.Text type="secondary">
              {statusDescription} {t('wiki.detail.updatedAt', { date: formatDate(page.updated_at) })}
            </Typography.Text>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/spaces/${encodeURIComponent(spaceId)}/wiki`}>
            <Button icon={<ArrowLeftOutlined />}>{t('wiki.detail.backToWiki')}</Button>
          </Link>
          <Link to={`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}/history`}>
            <Button icon={<HistoryOutlined />}>{t('wiki.detail.history')}</Button>
          </Link>
          {canPublish && (
            <Button
              type="primary"
              loading={isPublishing}
              disabled={isUnpublishing}
              onClick={() => { void publishCurrentVersion(); }}
            >
              {t('wiki.detail.publish')}
            </Button>
          )}
          {canUnpublish && (
            <Button
              danger
              loading={isUnpublishing}
              disabled={isPublishing}
              onClick={() => { void unpublishCurrentVersion(); }}
            >
              {t('wiki.detail.unpublish')}
            </Button>
          )}
        </div>
      </div>

      {error !== null && (
        <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {isLoading ? (
        <Spin tip={t('wiki.detail.loadingPage')}><div style={{ minHeight: 200 }} /></Spin>
      ) : page !== null && content !== null ? (
        <div style={{ background: 'var(--ant-color-bg-container, #fff)', color: 'var(--ant-color-text, #1f2933)', padding: 24, borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <WikiStatusBadge status={page.status} />
            <Typography.Text type="secondary">
              {t('wiki.detail.updatedAt', { date: formatDate(page.updated_at) })}
            </Typography.Text>
            {versionId !== undefined && versionId.length > 0 && (
              <Tag>{t('wiki.detail.version', { id: content.version_id })}</Tag>
            )}
          </div>
          <TiptapRenderer markdown={content.content_markdown} />
        </div>
      ) : (
        <Typography.Text type="secondary">{t('wiki.detail.unavailable')}</Typography.Text>
      )}
    </>
  );
}
