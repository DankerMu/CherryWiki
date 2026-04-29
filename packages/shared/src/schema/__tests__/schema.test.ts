import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';

const coreTableExports = [
  'tenants',
  'users',
  'groups',
  'group_members',
  'spaces',
  'space_permissions',
  'sessions',
  'audit_logs',
  'model_configs',
] as const;

describe('Drizzle core schema', () => {
  it('exports all 9 core tables', () => {
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

  it('defines group_members composite primary key on group_id and user_id', () => {
    const tableConfig = getTableConfig(schema.group_members);
    const primaryKey = tableConfig.primaryKeys[0];

    expect(primaryKey).toBeDefined();
    expect(primaryKey?.columns.map((column) => column.name)).toEqual(['group_id', 'user_id']);
  });
});
