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
] as const;

describe('Drizzle core schema', () => {
  it('exports all 11 core tables', () => {
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

  it('defines group_members composite primary key on group_id and user_id', () => {
    const tableConfig = getTableConfig(schema.group_members);
    const primaryKey = tableConfig.primaryKeys[0];

    expect(primaryKey).toBeDefined();
    expect(primaryKey?.columns.map((column) => column.name)).toEqual(['group_id', 'user_id']);
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
