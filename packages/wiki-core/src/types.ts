export interface WikiFrontmatter {
  page_id: string;
  title: string;
  space_id: string;
  page_type: 'community' | 'god_node' | 'generated_article' | 'index';
  status: 'draft' | 'published' | 'archived';
  curation_status: 'auto_generated' | 'human_curated' | 'mixed';
  source: 'graphify' | 'human' | 'import' | 'rollback';
  graphify_run_id?: string;
  graphify_schema_version?: string;
  managed_by: 'graphify' | 'human_curated';
  source_document_ids: string[];
  graph_node_ids: string[];
  version: number;
  acl_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WikiSection {
  section_id: string;
  heading: string;
  level: number;
  section_index: number;
  start_offset: number | null;
  end_offset: number | null;
  content_hash: string | null;
}
