import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core';

export const pgVector = customType<{ data: number[]; driverData: string; config: { dimensions?: number } }>({
  dataType(config) {
    return typeof config?.dimensions === 'number' ? `vector(${config.dimensions})` : 'vector';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .filter((part) => part.length > 0)
      .map(Number);
  },
});

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull(),
    display_name: text('display_name').notNull(),
    password_hash: text('password_hash').notNull(),
    role: text('role').notNull().default('viewer'),
    status: text('status').notNull().default('active'),
    docmost_user_id: text('docmost_user_id'),
    permission_version: bigint('permission_version', { mode: 'number' }).notNull().default(1),
    last_login_at: timestamp('last_login_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('users_tenant_id_email_unique').on(table.tenant_id, table.email),
    index('idx_users_permission_version').on(table.tenant_id, table.id, table.permission_version),
  ],
);

export const groups = pgTable(
  'groups',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    description: text('description'),
    permission_version: bigint('permission_version', { mode: 'number' }).notNull().default(1),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('groups_tenant_id_name_unique').on(table.tenant_id, table.name),
    index('idx_groups_permission_version').on(table.tenant_id, table.id, table.permission_version),
  ],
);

export const group_members = pgTable(
  'group_members',
  {
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    group_id: text('group_id')
      .notNull()
      .references(() => groups.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.group_id, table.user_id] })],
);

export const spaces = pgTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    docmost_space_id: text('docmost_space_id'),
    wiki_repo_path: text('wiki_repo_path').notNull(),
    active_graphify_run_id: text('active_graphify_run_id'),
    active_index_snapshot_id: text('active_index_snapshot_id'),
    index_consistency_status: text('index_consistency_status').notNull().default('healthy'),
    permission_version: bigint('permission_version', { mode: 'number' }).notNull().default(1),
    strict_knowledge_only: boolean('strict_knowledge_only').notNull().default(true),
    graphify_config: jsonb('graphify_config').notNull().default(sql`'{}'::jsonb`),
    database_config: jsonb('database_config').notNull().default(sql`'{"enabled":false}'::jsonb`),
    default_publish_policy: text('default_publish_policy').notNull().default('editor_publish'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('spaces_tenant_id_slug_unique').on(table.tenant_id, table.slug),
    index('idx_spaces_consistency').on(table.index_consistency_status),
    index('idx_spaces_permission_version').on(table.tenant_id, table.id, table.permission_version),
  ],
);

export const space_permissions = pgTable(
  'space_permissions',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    group_id: text('group_id')
      .notNull()
      .references(() => groups.id),
    permission: text('permission').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('space_permissions_space_id_group_id_permission_unique').on(table.space_id, table.group_id, table.permission)],
);

export const permission_versions = pgTable(
  'permission_versions',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    actor_user_id: text('actor_user_id').references(() => users.id),
    change_type: text('change_type').notNull(),
    subject_type: text('subject_type').notNull(),
    subject_id: text('subject_id').notNull(),
    old_permissions_json: jsonb('old_permissions_json'),
    new_permissions_json: jsonb('new_permissions_json').notNull(),
    reason: text('reason'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_permission_versions_space').on(table.tenant_id, table.space_id, table.created_at.desc()),
    index('idx_permission_versions_subject').on(table.subject_type, table.subject_id),
  ],
);

export const model_configs = pgTable(
  'model_configs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    provider: text('provider').notNull(),
    model_id: text('model_id').notNull(),
    model_type: text('model_type').notNull(),
    display_name: text('display_name'),
    base_url: text('base_url'),
    encrypted_api_key_ref: text('encrypted_api_key_ref'),
    embedding_dim: integer('embedding_dim'),
    max_tokens: integer('max_tokens'),
    rate_limit_rpm: integer('rate_limit_rpm'),
    enabled: boolean('enabled').notNull().default(true),
    visible_group_ids: jsonb('visible_group_ids').notNull().default(sql`'[]'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('model_configs_tenant_id_provider_model_id_unique').on(table.tenant_id, table.provider, table.model_id),
    index('idx_model_configs_tenant_type').on(table.tenant_id, table.model_type, table.enabled),
  ],
);

export const audit_logs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    actor_user_id: text('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    resource_type: text('resource_type').notNull(),
    resource_id: text('resource_id'),
    space_id: text('space_id'),
    ip: text('ip'),
    user_agent: text('user_agent'),
    request_id: text('request_id'),
    metadata_json: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_audit_logs_tenant_time').on(table.tenant_id, table.created_at.desc())],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    refresh_token_hash: text('refresh_token_hash').notNull(),
    ip: text('ip'),
    user_agent: text('user_agent'),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sessions_refresh_token_hash_unique').on(table.refresh_token_hash),
    index('idx_sessions_user').on(table.tenant_id, table.user_id).where(sql`${table.revoked_at} IS NULL`),
    index('idx_sessions_refresh').on(table.refresh_token_hash).where(sql`${table.revoked_at} IS NULL`),
  ],
);

export const system_settings = pgTable(
  'system_settings',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    category: text('category').notNull(),
    key: text('key').notNull(),
    value_json: jsonb('value_json').notNull(),
    updated_by: text('updated_by').references(() => users.id),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('system_settings_tenant_id_category_key_unique').on(table.tenant_id, table.category, table.key)],
);

export const file_blobs = pgTable(
  'file_blobs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sha256: text('sha256').notNull(),
    size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mime_type: text('mime_type').notNull(),
    storage_uri: text('storage_uri').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('file_blobs_tenant_id_sha256_unique').on(table.tenant_id, table.sha256)],
);

export const source_documents = pgTable(
  'source_documents',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    file_blob_id: text('file_blob_id').references(() => file_blobs.id),
    filename: text('filename').notNull(),
    uploader_id: text('uploader_id').references(() => users.id),
    source_type: text('source_type').notNull().default('upload'),
    classification: text('classification'),
    status: text('status').notNull().default('uploaded'),
    parsed_uri: text('parsed_uri'),
    metadata_json: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('source_documents_space_id_file_blob_id_unique').on(table.space_id, table.file_blob_id)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id').references(() => spaces.id),
    queue_name: text('queue_name').notNull().default('default'),
    type: text('type').notNull(),
    priority: integer('priority').notNull().default(100),
    status: text('status').notNull().default('pending'),
    attempt_count: integer('attempt_count').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(3),
    timeout_seconds: integer('timeout_seconds'),
    locked_by: text('locked_by'),
    locked_at: timestamp('locked_at', { withTimezone: true }),
    next_run_at: timestamp('next_run_at', { withTimezone: true }),
    cancel_requested_at: timestamp('cancel_requested_at', { withTimezone: true }),
    payload_json: jsonb('payload_json').notNull().default(sql`'{}'::jsonb`),
    result_json: jsonb('result_json'),
    error_json: jsonb('error_json'),
    idempotency_key: text('idempotency_key'),
    created_by: text('created_by').references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('jobs_tenant_id_idempotency_key_unique').on(table.tenant_id, table.idempotency_key),
    index('idx_jobs_poll')
      .on(table.queue_name, table.status, table.priority, table.next_run_at)
      .where(sql`${table.status} = 'pending'`),
    index('idx_jobs_locked')
      .on(table.locked_by, table.locked_at)
      .where(sql`${table.locked_by} IS NOT NULL`),
    index('idx_jobs_space').on(table.tenant_id, table.space_id, table.type, table.status),
  ],
);

export const job_events = pgTable(
  'job_events',
  {
    id: text('id').primaryKey(),
    job_id: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    event_type: text('event_type').notNull(),
    detail_json: jsonb('detail_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_job_events_job').on(table.job_id, table.created_at)],
);

export const graphifyRuns = pgTable(
  'graphify_runs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    job_id: text('job_id').references(() => jobs.id),
    trigger_type: text('trigger_type').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('pending'),
    input_version: text('input_version'),
    output_version: text('output_version'),
    graphify_ref: text('graphify_ref'),
    graph_json_uri: text('graph_json_uri'),
    wiki_output_uri: text('wiki_output_uri'),
    report_uri: text('report_uri'),
    graph_html_uri: text('graph_html_uri'),
    schema_version: text('schema_version').notNull().default('v1'),
    stats_json: jsonb('stats_json').notNull().default(sql`'{}'::jsonb`),
    error_json: jsonb('error_json'),
    created_by: text('created_by').references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    started_at: timestamp('started_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('idx_graphify_runs_job').on(table.job_id)],
);

export const graphNodes = pgTable(
  'graph_nodes',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    graphify_run_id: text('graphify_run_id')
      .notNull()
      .references(() => graphifyRuns.id),
    node_key: text('node_key').notNull(),
    stable_key: text('stable_key').notNull(),
    label: text('label').notNull(),
    norm_label: text('norm_label'),
    type: text('type'),
    community_id: text('community_id'),
    wiki_page_pk: text('wiki_page_pk').references(() => wikiPages.id),
    page_version_id: text('page_version_id').references(() => wikiPageVersions.id),
    source_refs_json: jsonb('source_refs_json').notNull().default(sql`'[]'::jsonb`),
    acl_json: jsonb('acl_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('graph_nodes_tenant_id_space_id_graphify_run_id_node_key_unique').on(table.tenant_id, table.space_id, table.graphify_run_id, table.node_key),
    index('idx_graph_nodes_stable_key').on(table.tenant_id, table.space_id, table.stable_key),
    index('idx_graph_nodes_label_trgm').using('gin', sql`${table.label} gin_trgm_ops`),
  ],
);

export const graphNodeAliases = pgTable(
  'graph_node_aliases',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    node_stable_key: text('node_stable_key').notNull(),
    alias: text('alias').notNull(),
    source: text('source').notNull().default('graphify'),
    confidence: doublePrecision('confidence').notNull().default(1.0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('graph_node_aliases_tenant_id_space_id_node_stable_key_alias_unique').on(table.tenant_id, table.space_id, table.node_stable_key, table.alias),
    index('idx_graph_node_aliases_lookup').on(table.tenant_id, table.space_id, table.alias),
  ],
);

export const graphNodeMerges = pgTable(
  'graph_node_merges',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    from_stable_key: text('from_stable_key').notNull(),
    to_stable_key: text('to_stable_key').notNull(),
    reason: text('reason').notNull(),
    created_by: text('created_by').references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_graph_node_merges_from').on(table.tenant_id, table.space_id, table.from_stable_key)],
);

export const graphEdges = pgTable(
  'graph_edges',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    graphify_run_id: text('graphify_run_id')
      .notNull()
      .references(() => graphifyRuns.id),
    source_node_id: text('source_node_id')
      .notNull()
      .references(() => graphNodes.id),
    target_node_id: text('target_node_id')
      .notNull()
      .references(() => graphNodes.id),
    relation_type: text('relation_type').notNull(),
    confidence_label: text('confidence_label').notNull(),
    raw_confidence_score: doublePrecision('raw_confidence_score'),
    effective_confidence_score: doublePrecision('effective_confidence_score'),
    evidence_count: integer('evidence_count').notNull().default(1),
    evidence_refs_json: jsonb('evidence_refs_json').notNull().default(sql`'[]'::jsonb`),
    acl_json: jsonb('acl_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_graph_edges_source').on(table.source_node_id),
    index('idx_graph_edges_target').on(table.target_node_id),
    index('idx_graph_edges_confidence').on(table.confidence_label, table.effective_confidence_score),
  ],
);

export const graphCommunities = pgTable(
  'graph_communities',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    graphify_run_id: text('graphify_run_id')
      .notNull()
      .references(() => graphifyRuns.id),
    community_key: text('community_key').notNull(),
    label: text('label'),
    summary: text('summary'),
    node_count: integer('node_count').notNull().default(0),
    metadata_json: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('graph_communities_tenant_id_space_id_graphify_run_id_community_key_unique').on(table.tenant_id, table.space_id, table.graphify_run_id, table.community_key),
  ],
);

export const graphReports = pgTable('graph_reports', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  space_id: text('space_id')
    .notNull()
    .references(() => spaces.id),
  graphify_run_id: text('graphify_run_id')
    .notNull()
    .references(() => graphifyRuns.id),
  report_markdown: text('report_markdown').notNull(),
  stats_json: jsonb('stats_json').notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const wikiPages = pgTable(
  'wiki_pages',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    page_id: text('page_id').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: text('status').notNull().default('draft'),
    current_version_id: text('current_version_id'),
    indexed_version_id: text('indexed_version_id'),
    sync_status: text('sync_status').notNull().default('synced'),
    docmost_page_id: text('docmost_page_id'),
    created_by: text('created_by').references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique('wiki_pages_tenant_id_space_id_page_id_unique').on(table.tenant_id, table.space_id, table.page_id),
    index('idx_wiki_pages_indexed_version').on(table.indexed_version_id),
    index('idx_wiki_pages_current_indexed').on(table.current_version_id, table.indexed_version_id),
    foreignKey({
      name: 'fk_wiki_pages_current_version',
      columns: [table.current_version_id],
      foreignColumns: [wikiPageVersions.id],
    }),
    foreignKey({
      name: 'fk_wiki_pages_indexed_version',
      columns: [table.indexed_version_id],
      foreignColumns: [wikiPageVersions.id],
    }),
  ],
);

export const wikiPageVersions = pgTable(
  'wiki_page_versions',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    wiki_page_pk: text('wiki_page_pk')
      .notNull()
      .references(() => wikiPages.id),
    page_id: text('page_id').notNull(),
    version_no: integer('version_no').notNull(),
    content_markdown: text('content_markdown').notNull(),
    frontmatter_json: jsonb('frontmatter_json').notNull().default(sql`'{}'::jsonb`),
    source: text('source').notNull(),
    graphify_run_id: text('graphify_run_id'),
    commit_hash: text('commit_hash'),
    status: text('status').notNull().default('draft'),
    created_by: text('created_by').references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique('wiki_page_versions_wiki_page_pk_version_no_unique').on(table.wiki_page_pk, table.version_no),
    index('idx_wiki_versions_status').on(table.tenant_id, table.space_id, table.status, table.created_at.desc()),
  ],
);

export const wikiSections = pgTable(
  'wiki_sections',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    wiki_page_pk: text('wiki_page_pk')
      .notNull()
      .references(() => wikiPages.id),
    page_version_id: text('page_version_id')
      .notNull()
      .references(() => wikiPageVersions.id),
    section_id: text('section_id').notNull(),
    heading: text('heading').notNull(),
    level: integer('level').notNull().default(2),
    section_index: integer('section_index').notNull(),
    start_offset: integer('start_offset'),
    end_offset: integer('end_offset'),
    content_hash: text('content_hash'),
    acl_json: jsonb('acl_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('wiki_sections_page_version_id_section_id_unique').on(table.page_version_id, table.section_id),
    index('idx_wiki_sections_page_version').on(table.page_version_id),
  ],
);

export const pageBlockMetadata = pgTable(
  'page_block_metadata',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    wiki_page_pk: text('wiki_page_pk')
      .notNull()
      .references(() => wikiPages.id),
    page_version_id: text('page_version_id')
      .notNull()
      .references(() => wikiPageVersions.id),
    block_id: text('block_id').notNull(),
    owner: text('owner').notNull().default('graphify'),
    content_hash: text('content_hash').notNull(),
    graphify_run_id: text('graphify_run_id'),
    last_editor: text('last_editor').references(() => users.id),
    editable: boolean('editable').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('page_block_metadata_page_version_id_block_id_unique').on(table.page_version_id, table.block_id),
    index('idx_page_blocks_page_version').on(table.page_version_id),
    index('idx_page_blocks_owner').on(table.wiki_page_pk, table.owner),
  ],
);

export const sourceLinks = pgTable(
  'source_links',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    wiki_page_pk: text('wiki_page_pk')
      .notNull()
      .references(() => wikiPages.id),
    page_version_id: text('page_version_id')
      .notNull()
      .references(() => wikiPageVersions.id),
    section_id: text('section_id').references(() => wikiSections.id),
    source_document_id: text('source_document_id').references(() => source_documents.id),
    source_uri: text('source_uri'),
    quote_hash: text('quote_hash'),
    evidence_type: text('evidence_type').notNull().default('reference'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_source_links_page_version').on(table.page_version_id),
    index('idx_source_links_source_doc').on(table.source_document_id),
  ],
);

export const graphEvidenceRefs = pgTable(
  'graph_evidence_refs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    edge_id: text('edge_id')
      .notNull()
      .references(() => graphEdges.id, { onDelete: 'cascade' }),
    page_id: text('page_id').references(() => wikiPages.id),
    page_version_id: text('page_version_id').references(() => wikiPageVersions.id),
    section_id: text('section_id').references(() => wikiSections.id),
    source_document_id: text('source_document_id').references(() => source_documents.id),
    quote_text: text('quote_text'),
    confidence_contribution: doublePrecision('confidence_contribution'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_graph_evidence_refs_edge').on(table.edge_id),
    index('idx_graph_evidence_refs_page').on(table.page_id, table.page_version_id),
    index('idx_graph_evidence_refs_source_doc').on(table.source_document_id),
  ],
);

export const wikiUpdateProposals = pgTable('wiki_update_proposals', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  space_id: text('space_id')
    .notNull()
    .references(() => spaces.id),
  wiki_page_pk: text('wiki_page_pk').references(() => wikiPages.id),
  graphify_run_id: text('graphify_run_id').references(() => graphifyRuns.id),
  proposal_type: text('proposal_type').notNull(),
  status: text('status').notNull().default('pending'),
  diff_json: jsonb('diff_json').notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
});

export const indexSnapshots = pgTable(
  'index_snapshots',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    graphify_run_id: text('graphify_run_id').references(() => graphifyRuns.id),
    wiki_repo_commit_hash: text('wiki_repo_commit_hash').notNull(),
    embedding_model_id: text('embedding_model_id').notNull(),
    chunk_count: integer('chunk_count').notNull().default(0),
    node_count: integer('node_count').notNull().default(0),
    edge_count: integer('edge_count').notNull().default(0),
    status: text('status').notNull().default('building'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    activated_at: timestamp('activated_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_index_snapshots_space').on(table.tenant_id, table.space_id, table.status),
    index('idx_index_snapshots_active').on(table.space_id, table.activated_at.desc()),
    uniqueIndex('idx_index_snapshots_one_building_per_space')
      .on(table.tenant_id, table.space_id)
      .where(sql`${table.status} = 'building'`),
  ],
);

export const wikiChunks = pgTable(
  'wiki_chunks',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    wiki_page_pk: text('wiki_page_pk')
      .notNull()
      .references(() => wikiPages.id),
    page_version_id: text('page_version_id')
      .notNull()
      .references(() => wikiPageVersions.id),
    section_id: text('section_id').references(() => wikiSections.id),
    chunk_index: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    content_hash: text('content_hash'),
    token_count: integer('token_count'),
    index_status: text('index_status').notNull().default('pending'),
    index_snapshot_id: text('index_snapshot_id'),
    index_version: text('index_version'),
    indexed_at: timestamp('indexed_at', { withTimezone: true }),
    embedding_model_id: text('embedding_model_id'),
    injection_risk: boolean('injection_risk').notNull().default(false),
    source_chain_json: jsonb('source_chain_json').notNull().default(sql`'{}'::jsonb`),
    acl_json: jsonb('acl_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('wiki_chunks_snapshot_page_version_chunk_unique').on(
      table.index_snapshot_id,
      table.page_version_id,
      table.chunk_index,
    ),
    index('idx_wiki_chunks_space').on(table.tenant_id, table.space_id),
    index('idx_wiki_chunks_index_status').on(table.index_status, table.index_snapshot_id),
    // idx_wiki_chunks_fts is created by SQL migration because it requires a GIN to_tsvector expression.
  ],
);

export const embeddings = pgTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    chunk_id: text('chunk_id')
      .notNull()
      .references(() => wikiChunks.id, { onDelete: 'cascade' }),
    model_config_id: text('model_config_id')
      .notNull()
      .references(() => model_configs.id),
    embedding: pgVector('embedding'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_embeddings_model').on(table.model_config_id)],
);

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_chat_sessions_tenant_space_user').on(table.tenant_id, table.space_id, table.user_id),
    index('idx_chat_sessions_user_updated').on(table.user_id, table.updated_at.desc()),
  ],
);

export const chatSessionSpaces = pgTable(
  'chat_session_spaces',
  {
    session_id: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    tenant_id: text('tenant_id').notNull(),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    position: integer('position').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.space_id] }),
    index('idx_chat_session_spaces_tenant_space').on(table.tenant_id, table.space_id, table.session_id),
    index('idx_chat_session_spaces_position').on(table.session_id, table.position),
  ],
);

export const agentSessions = pgTable(
  'agent_sessions',
  {
    conversation_id: text('conversation_id')
      .primaryKey()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull().default('claude'),
    provider_session_id: text('provider_session_id'),
    work_dir: text('work_dir').notNull(),
    agent_home: text('agent_home').notNull(),
    status: text('status').notNull(),
    options_hash: text('options_hash'),
    owned_by_instance: text('owned_by_instance'),
    last_activity_at: timestamp('last_activity_at', { withTimezone: true }).notNull(),
    process_started_at: timestamp('process_started_at', { withTimezone: true }),
    process_stopped_at: timestamp('process_stopped_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_agent_sessions_status').on(table.status),
    index('idx_agent_sessions_instance').on(table.owned_by_instance),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    session_id: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    token_count: integer('token_count'),
    citations_json: jsonb('citations_json').notNull().default(sql`'[]'::jsonb`),
    metadata_json: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_chat_messages_session_created').on(table.session_id, table.created_at)],
);

export const retrievalTraces = pgTable('retrieval_traces', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  user_id: text('user_id').references(() => users.id),
  conversation_id: text('conversation_id').references(() => chatSessions.id),
  space_ids: text('space_ids').array().notNull(),
  query: text('query').notNull(),
  retrieval_mode: text('retrieval_mode').notNull(),
  candidates_json: jsonb('candidates_json').notNull().default(sql`'[]'::jsonb`),
  acl_filtered_json: jsonb('acl_filtered_json').notNull().default(sql`'[]'::jsonb`),
  final_context_json: jsonb('final_context_json').notNull().default(sql`'[]'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelUsageLogs = pgTable(
  'model_usage_logs',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    user_id: text('user_id').references(() => users.id),
    model_config_id: text('model_config_id')
      .notNull()
      .references(() => model_configs.id),
    request_type: text('request_type').notNull(),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    latency_ms: integer('latency_ms'),
    space_id: text('space_id').references(() => spaces.id),
    conversation_id: text('conversation_id').references(() => chatSessions.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_model_usage_logs_user').on(table.tenant_id, table.user_id, table.created_at),
    index('idx_model_usage_logs_model').on(table.model_config_id, table.created_at),
  ],
);

export const answerCitations = pgTable(
  'answer_citations',
  {
    id: text('id').primaryKey(),
    message_id: text('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    wiki_page_pk: text('wiki_page_pk')
      .notNull()
      .references(() => wikiPages.id),
    space_id: text('space_id').references(() => spaces.id),
    section_id: text('section_id').references(() => wikiSections.id, { onDelete: 'set null' }),
    chunk_id: text('chunk_id').references(() => wikiChunks.id, { onDelete: 'set null' }),
    relevance_score: real('relevance_score').notNull(),
    source_chain_json: jsonb('source_chain_json').notNull(),
    display_text: text('display_text').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_answer_citations_message').on(table.message_id),
    index('idx_answer_citations_page').on(table.wiki_page_pk),
    index('idx_answer_citations_space').on(table.space_id),
  ],
);

export const bridgeEvents = pgTable(
  'bridge_events',
  {
    id: text('id').primaryKey(),
    event_id: varchar('event_id', { length: 64 }).notNull(),
    event_type: varchar('event_type', { length: 50 }).notNull(),
    source: varchar('source', { length: 20 }).notNull().default('docmost'),
    space_id: varchar('space_id', { length: 64 }),
    page_id: varchar('page_id', { length: 64 }),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('received'),
    error_json: jsonb('error_json'),
    nonce: varchar('nonce', { length: 64 }),
    received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processed_at: timestamp('processed_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('bridge_events_event_id_unique').on(table.event_id),
    index('idx_bridge_events_space_type_received').on(table.space_id, table.event_type, table.received_at.desc()),
    index('idx_bridge_events_pending').on(table.status).where(sql`${table.status} IN ('received', 'processing')`),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    bridge_event_id: text('bridge_event_id')
      .notNull()
      .references(() => bridgeEvents.id, { onDelete: 'cascade' }),
    direction: varchar('direction', { length: 10 }).notNull(),
    attempt: integer('attempt').notNull().default(1),
    status_code: integer('status_code'),
    response_time_ms: integer('response_time_ms'),
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_webhook_deliveries_event_attempt').on(table.bridge_event_id, table.attempt),
    index('idx_webhook_deliveries_direction_created').on(table.direction, table.created_at.desc()),
  ],
);

export const feedbackItems = pgTable('feedback_items', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  user_id: text('user_id').references(() => users.id),
  message_id: text('message_id').references(() => chatMessages.id),
  space_id: text('space_id').references(() => spaces.id),
  feedback_type: text('feedback_type').notNull(),
  status: text('status').notNull().default('open'),
  payload_json: jsonb('payload_json').notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolved_by: text('resolved_by').references(() => users.id),
  resolution_note: text('resolution_note'),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
});

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    token_hash: text('token_hash').notNull(),
    token_prefix: text('token_prefix').notNull().default(''),
    scopes: text('scopes').array().notNull().default(sql`'{}'`),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('api_tokens_token_hash_unique').on(table.token_hash),
    index('idx_api_tokens_user').on(table.tenant_id, table.user_id).where(sql`${table.revoked_at} IS NULL`),
  ],
);

export const mcpToolRegistry = pgTable(
  'mcp_tool_registry',
  {
    id: text('id').primaryKey(),
    tenant_id: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    tool_name: text('tool_name').notNull(),
    description: text('description'),
    server_url: text('server_url').notNull(),
    transport: text('transport').notNull().default('sse'),
    input_schema: jsonb('input_schema').notNull().default(sql`'{}'::jsonb`),
    scopes: text('scopes').array().notNull().default(sql`'{}'`),
    status: text('status').notNull().default('active'),
    policy_json: jsonb('policy_json').notNull().default(sql`'{}'::jsonb`),
    created_by: text('created_by').references(() => users.id),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('mcp_tool_registry_tenant_id_tool_name_unique').on(table.tenant_id, table.tool_name),
    index('idx_mcp_tool_registry_tenant').on(table.tenant_id, table.status),
  ],
);
