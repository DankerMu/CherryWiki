import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  formatDate,
  formatLabel,
  getErrorMessage,
} from '../../components/adminUi.js';
import { ApiError, type ApiMeta } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { wikiApi, type WikiPage, type WikiPageVersion } from '../../lib/wikiApi.js';
import NotFound from '../NotFound.js';
import { WIKI_PAGE_SIZE, WikiStatusBadge, getFirstItemIndex, getLastItemIndex } from './wikiUi.js';

type WikiVersionHistoryProps = {
  spaceId: string;
  pageId: string;
};

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: WIKI_PAGE_SIZE,
  total: 0,
  has_next: false,
};

export default function WikiVersionHistory({ spaceId, pageId }: WikiVersionHistoryProps) {
  const { hasSpacePermission } = useAuth();
  const canRollback = hasSpacePermission(spaceId, 'wiki:rollback');
  const navigate = useNavigate();
  const [page, setPage] = useState<WikiPage | null>(null);
  const [versions, setVersions] = useState<WikiPageVersion[]>([]);
  const [pageNumber, setPageNumber] = useState(DEFAULT_PAGINATION.page);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [rollingBackVersionId, setRollingBackVersionId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    setIsLoading(true);
    setNotFound(false);
    setError(null);

    try {
      const [pageResponse, versionsResponse] = await Promise.all([
        wikiApi.getPage(spaceId, pageId),
        wikiApi.listVersions(spaceId, pageId, { page: pageNumber, per_page: WIKI_PAGE_SIZE }),
      ]);
      setPage(pageResponse.data);
      setVersions(versionsResponse.data);
      setPagination(
        versionsResponse.meta?.pagination ?? {
          page: pageNumber,
          per_page: WIKI_PAGE_SIZE,
          total: versionsResponse.data.length,
          has_next: false,
        },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setIsLoading(false);
    }
  }, [pageId, pageNumber, spaceId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  async function rollbackVersion(version: WikiPageVersion): Promise<void> {
    setRollingBackVersionId(version.version_id);
    setError(null);

    try {
      await wikiApi.rollback(spaceId, pageId, version.version_id);
      void navigate(`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRollingBackVersionId(null);
    }
  }

  function openVersion(version: WikiPageVersion): void {
    void navigate(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}?version_id=${encodeURIComponent(version.version_id)}`,
    );
  }

  if (notFound) {
    return (
      <main className="admin-content wiki-page">
        <NotFound />
      </main>
    );
  }

  return (
    <main className="admin-content wiki-page">
      <PageHeader
        title="Version History"
        {...(page !== null ? { description: page.title } : {})}
        actions={
          <Link className="button button-secondary" to={`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(pageId)}`}>
            Back to Page
          </Link>
        }
      />

      <ErrorBanner error={error} />

      <section className="detail-panel" aria-label="Wiki version history">
        {isLoading ? (
          <LoadingState label="Loading wiki versions..." />
        ) : versions.length === 0 ? (
          <EmptyState label="No versions are available for this page." />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Created By</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => {
                    const isCurrent = version.status === 'current';
                    return (
                      <tr
                        key={version.version_id}
                        className="interactive-row"
                        tabIndex={0}
                        onClick={() => openVersion(version)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openVersion(version);
                          }
                        }}
                      >
                        <td>
                          <strong>{version.version_id}</strong>
                        </td>
                        <td>{formatLabel(version.source_run_id ?? 'manual')}</td>
                        <td>
                          <WikiStatusBadge status={version.status} />
                        </td>
                        <td>{version.author}</td>
                        <td>{formatDate(version.created_at)}</td>
                        <td>
                          {!isCurrent && canRollback ? (
                            <button
                              className="button button-secondary"
                              type="button"
                              disabled={rollingBackVersionId === version.version_id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void rollbackVersion(version);
                              }}
                            >
                              {rollingBackVersionId === version.version_id ? 'Rolling back...' : 'Rollback'}
                            </button>
                          ) : (
                            <span className="pagination-summary">Current</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar">
              <span className="pagination-summary">
                Showing {getFirstItemIndex(pagination.page, pagination.total)}-
                {getLastItemIndex(pagination.page, versions.length, pagination.total)} of {pagination.total}
              </span>
              <div className="upload-pagination-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setPageNumber(pagination.page - 1)}
                >
                  Previous
                </button>
                <span className="pagination-summary">
                  Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / WIKI_PAGE_SIZE), pagination.page)}
                </span>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={!pagination.has_next}
                  onClick={() => setPageNumber(pagination.page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
