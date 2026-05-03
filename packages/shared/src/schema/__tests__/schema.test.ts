import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';

const coreTableExports = [
  'tenants',
  'users',
  'groups',
  'group_members',
  'spaces',
  'space_permissions',
  'permission_versions',
  'sessions',
  'audit_logs',
  'model_configs',
  'system_settings',
  'file_blobs',
  'source_documents',
  'jobs',
  'job_events',
] as const;

describe('Drizzle core schema', () => {
  it('exports all 15 core tables', () => {
    for (const tableName of coreTableExports) {
      expect(Object.hasOwn(schema, tableName)).toBe(true);
    }
  });

  it('maps key column SQL types and defaults', () => {
    expect(schema.users.permission_version.getSQLType()).toBe('bigint');
    expect(schema.users.permission_version.notNull).toBe(true);
    expect(schema.users.permission_version.default).toBe(1);

    expect(schema.spaces.strict_knowledge_only.getSQLType()).toBe('boolean');
    expect(schema.spaces.strict_knowledge_only.notNull).toBe(true);
    expect(schema.spaces.strict_knowledge_only.default).toBe(true);

    expect(schema.audit_logs.metadata_json.getSQLType()).toBe('jsonb');
    expect(schema.audit_logs.metadata_json.notNull).toBe(true);

    expect(schema.model_configs.visible_group_ids.getSQLType()).toBe('jsonb');
    expect(schema.model_configs.visible_group_ids.notNull).toBe(true);
  });

  it('maps users authentication and role columns', () => {
    expect(schema.users.password_hash.getSQLType()).toBe('text');
    expect(schema.users.password_hash.notNull).toBe(true);

    expect(schema.users.role.getSQLType()).toBe('text');
    expect(schema.users.role.notNull).toBe(true);
    expect(schema.users.role.default).toBe('viewer');

    expect(schema.users.last_login_at.getSQLType()).toBe('timestamp with time zone');
    expect(schema.users.last_login_at.notNull).toBe(false);
  });

  it('maps spaces description and status columns', () => {
    expect(schema.spaces.description.getSQLType()).toBe('text');
    expect(schema.spaces.description.notNull).toBe(false);

    expect(schema.spaces.status.getSQLType()).toBe('text');
    expect(schema.spaces.status.notNull).toBe(true);
    expect(schema.spaces.status.default).toBe('active');
  });

  it('maps sessions last_used_at column', () => {
    expect(schema.sessions.last_used_at.getSQLType()).toBe('timestamp with time zone');
    expect(schema.sessions.last_used_at.notNull).toBe(false);
  });

  it('defines permission_versions columns and indexes', () => {
    expect(schema.permission_versions.change_type.getSQLType()).toBe('text');
    expect(schema.permission_versions.change_type.notNull).toBe(true);
    expect(schema.permission_versions.subject_type.notNull).toBe(true);
    expect(schema.permission_versions.subject_id.notNull).toBe(true);
    expect(schema.permission_versions.old_permissions_json.getSQLType()).toBe('jsonb');
    expect(schema.permission_versions.old_permissions_json.notNull).toBe(false);
    expect(schema.permission_versions.new_permissions_json.getSQLType()).toBe('jsonb');
    expect(schema.permission_versions.new_permissions_json.notNull).toBe(true);

    expect(indexColumns(schema.permission_versions, 'idx_permission_versions_space')).toEqual(['tenant_id', 'space_id', 'created_at']);
    expect(indexColumns(schema.permission_versions, 'idx_permission_versions_subject')).toEqual(['subject_type', 'subject_id']);
  });

  it('defines system_settings columns and unique constraint', () => {
    expect(schema.system_settings.category.getSQLType()).toBe('text');
    expect(schema.system_settings.category.notNull).toBe(true);
    expect(schema.system_settings.key.getSQLType()).toBe('text');
    expect(schema.system_settings.key.notNull).toBe(true);
    expect(schema.system_settings.value_json.getSQLType()).toBe('jsonb');
    expect(schema.system_settings.value_json.notNull).toBe(true);

    expect(uniqueColumns(schema.system_settings, 'system_settings_tenant_id_category_key_unique')).toEqual(['tenant_id', 'category', 'key']);
  });

  it('defines jobs columns, defaults, indexes, and idempotency uniqueness', () => {
    expect(schema.jobs.queue_name.getSQLType()).toBe('text');
    expect(schema.jobs.queue_name.notNull).toBe(true);
    expect(schema.jobs.queue_name.default).toBe('default');

    expect(schema.jobs.priority.getSQLType()).toBe('integer');
    expect(schema.jobs.priority.default).toBe(100);
    expect(schema.jobs.status.default).toBe('pending');
    expect(schema.jobs.attempt_count.default).toBe(0);
    expect(schema.jobs.max_attempts.default).toBe(3);

    expect(schema.jobs.payload_json.getSQLType()).toBe('jsonb');
    expect(schema.jobs.payload_json.notNull).toBe(true);
    expect(schema.jobs.result_json.notNull).toBe(false);
    expect(schema.jobs.error_json.notNull).toBe(false);
    expect(schema.jobs.locked_at.getSQLType()).toBe('timestamp with time zone');
    expect(schema.jobs.completed_at.getSQLType()).toBe('timestamp with time zone');

    expect(uniqueColumns(schema.jobs, 'jobs_tenant_id_idempotency_key_unique')).toEqual(['tenant_id', 'idempotency_key']);
    expect(indexColumns(schema.jobs, 'idx_jobs_poll')).toEqual(['queue_name', 'status', 'priority', 'next_run_at']);
    expect(indexColumns(schema.jobs, 'idx_jobs_locked')).toEqual(['locked_by', 'locked_at']);
    expect(indexColumns(schema.jobs, 'idx_jobs_space')).toEqual(['tenant_id', 'space_id', 'type', 'status']);
  });

  it('defines upload blob and source document tables', () => {
    expect(schema.file_blobs.sha256.getSQLType()).toBe('text');
    expect(schema.file_blobs.sha256.notNull).toBe(true);
    expect(schema.file_blobs.size_bytes.getSQLType()).toBe('bigint');
    expect(schema.file_blobs.storage_uri.notNull).toBe(true);
    expect(uniqueColumns(schema.file_blobs, 'file_blobs_tenant_id_sha256_unique')).toEqual(['tenant_id', 'sha256']);

    expect(schema.source_documents.file_blob_id.notNull).toBe(false);
    expect(schema.source_documents.source_type.default).toBe('upload');
    expect(schema.source_documents.status.default).toBe('uploaded');
    expect(schema.source_documents.metadata_json.getSQLType()).toBe('jsonb');
    expect(schema.source_documents.metadata_json.notNull).toBe(true);
    expect(uniqueColumns(schema.source_documents, 'source_documents_space_id_file_blob_id_unique')).toEqual([
      'space_id',
      'file_blob_id',
    ]);
  });

  it('defines job_events columns, cascade foreign key, and lookup index', () => {
    expect(schema.job_events.event_type.getSQLType()).toBe('text');
    expect(schema.job_events.event_type.notNull).toBe(true);
    expect(schema.job_events.detail_json.getSQLType()).toBe('jsonb');
    expect(schema.job_events.detail_json.notNull).toBe(true);
    expect(schema.job_events.created_at.getSQLType()).toBe('timestamp with time zone');

    expect(indexColumns(schema.job_events, 'idx_job_events_job')).toEqual(['job_id', 'created_at']);
    expect(foreignKeyOnDelete(schema.job_events, 'job_events_job_id_jobs_id_fk')).toBe('cascade');
  });

  it('defines group_members composite primary key on group_id and user_id', () => {
    const tableConfig = getTableConfig(schema.group_members);
    const primaryKey = tableConfig.primaryKeys[0];

    expect(primaryKey).toBeDefined();
    expect(primaryKey?.columns.map((column) => column.name)).toEqual(['group_id', 'user_id']);
  });

  it('defines wikiChunks columns, defaults, uniqueness, and indexes', () => {
    expect(schema.wikiChunks.id.getSQLType()).toBe('text');
    expect(schema.wikiChunks.tenant_id.notNull).toBe(true);
    expect(schema.wikiChunks.space_id.notNull).toBe(true);
    expect(schema.wikiChunks.wiki_page_pk.notNull).toBe(true);
    expect(schema.wikiChunks.page_version_id.notNull).toBe(true);
    expect(schema.wikiChunks.section_id.notNull).toBe(false);
    expect(schema.wikiChunks.chunk_index.getSQLType()).toBe('integer');
    expect(schema.wikiChunks.chunk_index.notNull).toBe(true);
    expect(schema.wikiChunks.content.getSQLType()).toBe('text');
    expect(schema.wikiChunks.content.notNull).toBe(true);
    expect(schema.wikiChunks.content_hash.notNull).toBe(false);
    expect(schema.wikiChunks.token_count.getSQLType()).toBe('integer');
    expect(schema.wikiChunks.index_status.default).toBe('pending');
    expect(schema.wikiChunks.index_snapshot_id.notNull).toBe(false);
    expect(schema.wikiChunks.indexed_at.getSQLType()).toBe('timestamp with time zone');
    expect(schema.wikiChunks.embedding_model_id.notNull).toBe(false);
    expect(schema.wikiChunks.injection_risk.getSQLType()).toBe('boolean');
    expect(schema.wikiChunks.injection_risk.default).toBe(false);
    expect(schema.wikiChunks.source_chain_json.getSQLType()).toBe('jsonb');
    expect(schema.wikiChunks.source_chain_json.notNull).toBe(true);
    expect(schema.wikiChunks.acl_json.getSQLType()).toBe('jsonb');
    expect(schema.wikiChunks.acl_json.notNull).toBe(true);
    expect(schema.wikiChunks.created_at.getSQLType()).toBe('timestamp with time zone');

    expect(uniqueColumns(schema.wikiChunks, 'wiki_chunks_snapshot_page_version_chunk_unique')).toEqual([
      'index_snapshot_id',
      'page_version_id',
      'chunk_index',
    ]);
    expect(indexColumns(schema.wikiChunks, 'idx_wiki_chunks_space')).toEqual(['tenant_id', 'space_id']);
    expect(indexColumns(schema.wikiChunks, 'idx_wiki_chunks_index_status')).toEqual([
      'index_status',
      'index_snapshot_id',
    ]);
  });

  it('defines embeddings columns, cascade chunk foreign key, model foreign key, and index', () => {
    expect(schema.embeddings.id.getSQLType()).toBe('text');
    expect(schema.embeddings.tenant_id.notNull).toBe(true);
    expect(schema.embeddings.space_id.notNull).toBe(true);
    expect(schema.embeddings.chunk_id.notNull).toBe(true);
    expect(schema.embeddings.model_config_id.notNull).toBe(true);
    expect(schema.embeddings.embedding.getSQLType()).toBe('vector');
    expect(schema.embeddings.embedding.notNull).toBe(false);
    expect(schema.embeddings.created_at.getSQLType()).toBe('timestamp with time zone');

    expect(foreignKeyOnDelete(schema.embeddings, 'embeddings_chunk_id_wiki_chunks_id_fk')).toBe('cascade');
    expect(foreignKeyColumns(schema.embeddings, 'embeddings_model_config_id_model_configs_id_fk')).toEqual([
      'model_config_id',
    ]);
    expect(indexColumns(schema.embeddings, 'idx_embeddings_model')).toEqual(['model_config_id']);
  });

  it('defines the pgvector custom type used by embeddings', () => {
    expect(Object.hasOwn(schema, 'pgVector')).toBe(true);
    expect(schema.embeddings.embedding.getSQLType()).toBe('vector');
  });
});

function indexColumns(table: PgTable, indexName: string): string[] {
  const tableConfig = getTableConfig(table);
  const indexConfig = tableConfig.indexes.find((candidate) => candidate.config.name === indexName);

  expect(indexConfig).toBeDefined();

  return (indexConfig?.config.columns ?? []).map((column) => (column as { name: string }).name);
}

function uniqueColumns(table: PgTable, constraintName: string): string[] {
  const tableConfig = getTableConfig(table);
  const uniqueConstraint = tableConfig.uniqueConstraints.find((candidate) => candidate.getName() === constraintName);

  expect(uniqueConstraint).toBeDefined();

  return uniqueConstraint?.columns.map((column) => column.name) ?? [];
}

function foreignKeyOnDelete(table: PgTable, foreignKeyName: string): string | undefined {
  const tableConfig = getTableConfig(table);
  const foreignKey = tableConfig.foreignKeys.find((candidate) => candidate.getName() === foreignKeyName);

  expect(foreignKey).toBeDefined();

  return foreignKey?.onDelete;
}

function foreignKeyColumns(table: PgTable, foreignKeyName: string): string[] {
  const tableConfig = getTableConfig(table);
  const foreignKey = tableConfig.foreignKeys.find((candidate) => candidate.getName() === foreignKeyName);

  expect(foreignKey).toBeDefined();

  return foreignKey?.reference().columns.map((column) => column.name) ?? [];
}
