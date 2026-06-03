import { api, type ApiWrappedResponse } from './api.js';

export type WikiPage = {
  id: string;
  page_id: string;
  space_id: string;
  title: string;
  slug: string;
  status: string;
  current_version_id: string | null;
  indexed_version_id: string | null;
  sync_status: string;
  created_by: string | null;
  updated_at: string;
};

export type WikiPageVersion = {
  version_id: string;
  content_hash: string;
  author: string;
  source_run_id: string | null;
  status: 'current' | 'archived';
  created_at: string;
};

export type WikiPageContent = {
  page_id: string;
  version_id: string;
  title: string;
  content_markdown: string;
};

export type WikiDiff = {
  from_version_id: string;
  to_version_id: string;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
  stats: {
    additions: number;
    deletions: number;
  };
};

export type WikiPageListResponse = ApiWrappedResponse<WikiPage[]>;
export type WikiPageResponse = ApiWrappedResponse<WikiPage>;
export type WikiPageContentResponse = ApiWrappedResponse<WikiPageContent>;
export type WikiPageVersionListResponse = ApiWrappedResponse<WikiPageVersion[]>;
export type WikiDiffResponse = ApiWrappedResponse<WikiDiff>;

export const wikiApi = {
  listPages(spaceId: string, params: { page?: number; per_page?: number; status?: string; search?: string } = {}) {
    return api.getWrapped<WikiPage[]>(`/spaces/${encodeURIComponent(spaceId)}/wiki/pages`, params);
  },

  getPage(spaceId: string, pageId: string) {
    return api.getWrapped<WikiPage>(`/spaces/${encodeURIComponent(spaceId)}/wiki/pages/${encodeURIComponent(pageId)}`);
  },

  getContent(spaceId: string, pageId: string, versionId?: string) {
    const query = versionId ? { version_id: versionId } : undefined;
    return api.getWrapped<WikiPageContent>(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/pages/${encodeURIComponent(pageId)}/content`,
      query,
    );
  },

  listVersions(spaceId: string, pageId: string, params: { page?: number; per_page?: number } = {}) {
    return api.getWrapped<WikiPageVersion[]>(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/pages/${encodeURIComponent(pageId)}/versions`,
      params,
    );
  },

  getDiff(spaceId: string, pageId: string, fromVersionId: string, toVersionId: string) {
    return api.getWrapped<WikiDiff>(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/pages/${encodeURIComponent(pageId)}/diff`,
      { from_version_id: fromVersionId, to_version_id: toVersionId },
    );
  },

  publish(spaceId: string, pageId: string, versionId: string, publishNote?: string) {
    return api.post<{ page_id: string; version_id: string; status: string }>(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/pages/${encodeURIComponent(pageId)}/publish`,
      { version_id: versionId, publish_note: publishNote },
    );
  },

  unpublish(spaceId: string, pageId: string, versionId: string, reason?: string) {
    return api.post<{ page_id: string; version_id: string; status: string }>(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/pages/${encodeURIComponent(pageId)}/unpublish`,
      { version_id: versionId, reason },
    );
  },

  rollback(spaceId: string, pageId: string, targetVersionId: string, reason?: string) {
    return api.post<{ page_id: string; new_version_id: string; status: string }>(
      `/spaces/${encodeURIComponent(spaceId)}/wiki/pages/${encodeURIComponent(pageId)}/rollback`,
      { target_version_id: targetVersionId, reason },
    );
  },
};
