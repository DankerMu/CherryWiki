import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';

const validUserInput = {
  tenant_id: 'default',
  email: 'admin@cherrywiki.local',
  display_name: 'Admin User',
  password: 'Admin123!@#',
  role: 'admin',
};

const validSpaceInput = {
  tenant_id: 'default',
  name: 'Knowledge Base',
  slug: 'knowledge-base',
  description: 'Internal docs',
};

const validModelConfigInput = {
  tenant_id: 'default',
  provider: 'openai',
  model_id: 'gpt-4.1',
  model_type: 'chat',
};

describe('Zod schema validation', () => {
  it('validates insertUserSchema inputs', () => {
    expect(schema.insertUserSchema.safeParse(validUserInput).success).toBe(true);

    const missingEmail: Record<string, unknown> = { ...validUserInput };
    delete missingEmail.email;
    expect(schema.insertUserSchema.safeParse(missingEmail).success).toBe(false);

    expect(schema.insertUserSchema.safeParse({ ...validUserInput, role: 'super_admin' }).success).toBe(false);
    expect(schema.insertUserSchema.safeParse({ ...validUserInput, password: 'short' }).success).toBe(false);
  });

  it('validates insertSpaceSchema inputs', () => {
    expect(schema.insertSpaceSchema.safeParse(validSpaceInput).success).toBe(true);

    const missingName: Record<string, unknown> = { ...validSpaceInput };
    delete missingName.name;
    expect(schema.insertSpaceSchema.safeParse(missingName).success).toBe(false);
  });

  it('validates insertModelConfigSchema inputs', () => {
    expect(schema.insertModelConfigSchema.safeParse(validModelConfigInput).success).toBe(true);
    expect(schema.insertModelConfigSchema.safeParse({ ...validModelConfigInput, model_type: 'completion' }).success).toBe(false);
  });

  it('requires tenant_id on all core business tables', () => {
    for (const table of tenantScopedTables) {
      expect(table.tenant_id.notNull).toBe(true);
    }
  });
});

const tenantScopedTables = [
  schema.users,
  schema.groups,
  schema.group_members,
  schema.spaces,
  schema.space_permissions,
  schema.permission_versions,
  schema.model_configs,
  schema.audit_logs,
  schema.sessions,
  schema.system_settings,
] as const satisfies readonly { tenant_id: { notNull: boolean } }[];
