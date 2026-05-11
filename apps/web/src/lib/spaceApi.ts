import { api, type ApiWrappedResponse } from './api';

export type SpaceDetail = {
  id: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  active_graphify_run_id: string | null;
  active_index_snapshot_id: string | null;
  index_consistency_status: string;
  strict_knowledge_only: boolean;
  created_at: string;
  updated_at: string;
};

export type SpaceStats = {
  space_id?: string;
  source_count: number;
  page_count: number;
  node_count: number;
  edge_count: number;
  index_consistency: string;
};

export type RecentDocument = {
  id: string;
  filename: string;
  mime_type: string | null;
  source_type: string;
  status: string;
  updated_at: string;
};

export type RecentWikiPage = {
  id: string;
  page_id: string;
  space_id: string;
  title: string;
  status: string;
  updated_at: string;
};

export function getSpace(spaceId: string): Promise<SpaceDetail> {
  return api.get<SpaceDetail>(`/spaces/${encodeURIComponent(spaceId)}`);
}

export function getSpaceStats(spaceId: string): Promise<SpaceStats> {
  return api.get<SpaceStats>(`/spaces/${encodeURIComponent(spaceId)}/stats`);
}

export function getRecentDocuments(spaceId: string): Promise<ApiWrappedResponse<RecentDocument[]>> {
  return api.getWrapped<RecentDocument[]>(`/spaces/${encodeURIComponent(spaceId)}/uploads`, {
    per_page: 5,
    sort: '-updated_at',
  });
}

export function getRecentWikiPages(spaceId: string): Promise<ApiWrappedResponse<RecentWikiPage[]>> {
  return api.getWrapped<RecentWikiPage[]>(`/spaces/${encodeURIComponent(spaceId)}/wiki/pages`, {
    per_page: 5,
  });
}
