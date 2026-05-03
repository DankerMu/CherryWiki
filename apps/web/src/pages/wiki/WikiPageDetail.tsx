import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import {
  ErrorBanner,
  LoadingState,
  PageHeader,
  formatDate,
  getErrorMessage,
} from '../../components/adminUi.js';
import SpaceNav from '../../components/SpaceNav.js';
import { ApiError } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { wikiApi, type WikiPage, type WikiPageContent } from '../../lib/wikiApi.js';
import NotFound from '../NotFound.js';
import { WikiStatusBadge } from './wikiUi.js';

type WikiPageDetailProps = {
  spaceId: string;
  pageId: string;
  versionId?: string;
};

export default function WikiPageDetail({ spaceId, pageId, versionId }: WikiPageDetailProps) {
  const { hasSpacePermission } = useAuth();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [content, setContent] = useState<WikiPageContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async () => {
    setIsLoading(true);
    setNotFound(false);
    setError(null);

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
  }, [pageId, spaceId, versionId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  async function publishCurrentVersion(): Promise<void> {
    if (page?.current_version_id === null || page?.current_version_id === undefined) {
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

  if (notFound) {
    return (
      <main className="admin-content wiki-page">
        <NotFound />
      </main>
    );
  }

  const canPublish =
    page !== null &&
    page.status === 'draft' &&
    page.current_version_id !== null &&
    hasSpacePermission(spaceId, 'wiki:publish');

  return (
    <main className="admin-content wiki-page">
      <PageHeader
        title={page?.title ?? 'Wiki Page'}
        {...(page !== null
          ? {
              description: `${page.status === 'draft' ? 'Draft' : page.status === 'published' ? 'Published' : 'Archived'} page updated ${formatDate(page.updated_at)}`,
            }
          : {})}
        actions={
          <>
            <SpaceNav spaceId={spaceId} />
            <Link className="button button-secondary" to={`/spaces/${encodeURIComponent(spaceId)}/wiki`}>
              Back to Wiki
            </Link>
            <Link className="button button-secondary" to={`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}/history`}>
              History
            </Link>
            {canPublish ? (
              <button
                className="button button-primary"
                type="button"
                disabled={isPublishing}
                onClick={() => {
                  void publishCurrentVersion();
                }}
              >
                {isPublishing ? 'Publishing...' : 'Publish'}
              </button>
            ) : null}
          </>
        }
      />

      <ErrorBanner error={error} />

      {isLoading ? (
        <LoadingState label="Loading wiki page..." />
      ) : page !== null && content !== null ? (
        <article className="detail-panel wiki-detail" aria-label="Wiki page content">
          <div className="wiki-detail-meta">
            <WikiStatusBadge status={page.status} />
            <span>Updated {formatDate(page.updated_at)}</span>
            {versionId !== undefined && versionId.length > 0 ? <span>Version {content.version_id}</span> : null}
          </div>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              img: (props) => <img {...props} referrerPolicy="no-referrer" loading="lazy" />,
            }}
          >
            {content.content_markdown}
          </ReactMarkdown>
        </article>
      ) : (
        <div className="muted-state">Wiki page content is unavailable.</div>
      )}
    </main>
  );
}
