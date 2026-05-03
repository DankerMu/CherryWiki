import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  formatDate,
  getErrorMessage,
} from '../../components/adminUi.js';
import SpaceNav from '../../components/SpaceNav.js';
import { type ApiMeta } from '../../lib/api.js';
import { wikiApi, type WikiPage } from '../../lib/wikiApi.js';
import { WIKI_PAGE_SIZE, WikiStatusBadge, getFirstItemIndex, getLastItemIndex } from './wikiUi.js';

type WikiPageListProps = {
  spaceId: string;
};

const DEFAULT_PAGINATION: NonNullable<ApiMeta['pagination']> = {
  page: 1,
  per_page: WIKI_PAGE_SIZE,
  total: 0,
  has_next: false,
};

const STATUS_OPTIONS = ['draft', 'published', 'archived'] as const;

export default function WikiPageList({ spaceId }: WikiPageListProps) {
  const navigate = useNavigate();
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [page, setPage] = useState(DEFAULT_PAGINATION.page);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPages = useCallback(async () => {
    if (spaceId.length === 0) {
      setPages([]);
      setPagination(DEFAULT_PAGINATION);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await wikiApi.listPages(spaceId, {
        page,
        per_page: WIKI_PAGE_SIZE,
        ...(statusFilter.length > 0 ? { status: statusFilter } : {}),
        ...(debouncedSearch.length > 0 ? { search: debouncedSearch } : {}),
      });
      setPages(response.data);
      setPagination(
        response.meta?.pagination ?? {
          page,
          per_page: WIKI_PAGE_SIZE,
          total: response.data.length,
          has_next: false,
        },
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, page, spaceId, statusFilter]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [spaceId]);

  function openPage(wikiPage: WikiPage): void {
    void navigate(`/spaces/${encodeURIComponent(spaceId)}/wiki/${encodeURIComponent(wikiPage.page_id)}`);
  }

  return (
    <main className="admin-content wiki-page">
      <PageHeader
        title="Wiki"
        description="Read canonical pages generated for this knowledge space."
        actions={<SpaceNav spaceId={spaceId} />}
      />

      <ErrorBanner error={error} />

      <section className="detail-panel" aria-label="Wiki pages">
        <div className="detail-panel-header">
          <div>
            <h2>Pages</h2>
            <p>Browse the current wiki page catalog.</p>
          </div>
        </div>

        <div className="toolbar">
          <label>
            Search
            <input
              type="search"
              value={searchInput}
              placeholder="Search titles"
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Status
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status[0]?.toUpperCase() ?? ''}
                  {status.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <LoadingState label="Loading wiki pages..." />
        ) : pages.length === 0 ? (
          <EmptyState label="No wiki pages in this space yet." />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Created By</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((wikiPage) => (
                    <tr
                      key={wikiPage.id}
                      className="interactive-row"
                      tabIndex={0}
                      onClick={() => openPage(wikiPage)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openPage(wikiPage);
                        }
                      }}
                    >
                      <td>
                        <strong>{wikiPage.title}</strong>
                        <span className="subtle-id">{wikiPage.page_id}</span>
                      </td>
                      <td>
                        <WikiStatusBadge status={wikiPage.status} />
                      </td>
                      <td>{formatDate(wikiPage.updated_at)}</td>
                      <td>{wikiPage.created_by ?? 'Unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar">
              <span className="pagination-summary">
                Showing {getFirstItemIndex(pagination.page, pagination.total)}-
                {getLastItemIndex(pagination.page, pages.length, pagination.total)} of {pagination.total}
              </span>
              <div className="upload-pagination-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(pagination.page - 1)}
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
                  onClick={() => setPage(pagination.page + 1)}
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
