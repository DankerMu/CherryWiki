import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';

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
