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

const validWikiPageInput = {
  tenant_id: 'tenant-1',
  space_id: 'space-1',
  page_id: 'rd-platform.community.community_1',
  title: 'Community 1',
  slug: 'Community_1',
};

const validWikiPageVersionInput = {
  tenant_id: 'tenant-1',
  space_id: 'space-1',
  wiki_page_pk: 'wiki-page-pk-1',
  page_id: 'rd-platform.community.community_1',
  version_no: 1,
  content_markdown: '# Community 1',
  source: 'graphify',
};

describe('Zod schema validation', () => {
  it('validates insertUserSchema inputs', () => {
    expect(schema.insertUserSchema.safeParse(validUserInput).success).toBe(true);

    const missingEmail: Record<string, unknown> = { ...validUserInput };
    delete missingEmail.email;
    expect(schema.insertUserSchema.safeParse(missingEmail).success).toBe(false);

    expect(schema.insertUserSchema.safeParse({ ...validUserInput, role: 'super_admin' }).success).toBe(false);
    expect(schema.insertUserSchema.safeParse({ ...validUserInput, status: 'invited' }).success).toBe(false);
    expect(schema.insertUserSchema.safeParse({ ...validUserInput, password: 'short' }).success).toBe(false);
    expect(schema.insertUserSchema.safeParse({ ...validUserInput, password: `A${'b'.repeat(128)}` }).success).toBe(false);
    expect(schema.insertUserSchema.safeParse({ ...validUserInput, email: `${'a'.repeat(245)}@example.com` }).success).toBe(false);
    expect(schema.insertUserSchema.safeParse({ ...validUserInput, display_name: 'a'.repeat(201) }).success).toBe(false);
  });

  it('validates insertSpaceSchema inputs', () => {
    expect(schema.insertSpaceSchema.safeParse(validSpaceInput).success).toBe(true);

    const missingName: Record<string, unknown> = { ...validSpaceInput };
    delete missingName.name;
    expect(schema.insertSpaceSchema.safeParse(missingName).success).toBe(false);

    const spaceWithRepoPath = schema.insertSpaceSchema.parse({ ...validSpaceInput, wiki_repo_path: '/custom/path' });
    expect(Object.hasOwn(spaceWithRepoPath, 'wiki_repo_path')).toBe(false);

    const updateWithRepoPath = schema.updateSpaceSchema.parse({ wiki_repo_path: '/custom/path' });
    expect(Object.hasOwn(updateWithRepoPath, 'wiki_repo_path')).toBe(false);

    expect(schema.insertSpaceSchema.safeParse({ ...validSpaceInput, status: 'disabled' }).success).toBe(false);
    expect(schema.insertSpaceSchema.safeParse({ ...validSpaceInput, name: 'a'.repeat(201) }).success).toBe(false);
    expect(schema.insertSpaceSchema.safeParse({ ...validSpaceInput, slug: 'a'.repeat(101) }).success).toBe(false);
    expect(schema.insertSpaceSchema.safeParse({ ...validSpaceInput, description: 'a'.repeat(5001) }).success).toBe(false);
    expect(schema.insertSpaceSchema.safeParse({ ...validSpaceInput, default_publish_policy: 'a'.repeat(101) }).success).toBe(false);
  });

  it('validates insertModelConfigSchema inputs', () => {
    expect(schema.insertModelConfigSchema.safeParse(validModelConfigInput).success).toBe(true);
    expect(schema.insertModelConfigSchema.safeParse({ ...validModelConfigInput, model_type: 'completion' }).success).toBe(false);
    expect(schema.insertModelConfigSchema.safeParse({ ...validModelConfigInput, provider: 'a'.repeat(201) }).success).toBe(false);
    expect(schema.insertModelConfigSchema.safeParse({ ...validModelConfigInput, model_id: 'a'.repeat(201) }).success).toBe(false);
    expect(schema.insertModelConfigSchema.safeParse({ ...validModelConfigInput, base_url: `https://example.com/${'a'.repeat(2048)}` }).success).toBe(false);
    expect(schema.insertModelConfigSchema.safeParse({ ...validModelConfigInput, encrypted_api_key_ref: 'a'.repeat(501) }).success).toBe(false);
    expect(schema.insertModelConfigSchema.safeParse({ ...validModelConfigInput, visible_group_ids: Array.from({ length: 101 }, (_, index) => `group-${index}`) }).success).toBe(false);
  });

  it('validates metadata and request context field bounds', () => {
    const longValue = 'a'.repeat(501);

    expect(
      schema.insertAuditLogSchema.safeParse({
        tenant_id: 'default',
        action: 'space.update',
        resource_type: 'space',
        ip: longValue,
      }).success,
    ).toBe(false);

    expect(
      schema.insertSessionSchema.safeParse({
        tenant_id: 'default',
        user_id: 'user-1',
        refresh_token_hash: 'hash',
        user_agent: longValue,
        expires_at: new Date(),
      }).success,
    ).toBe(false);

    expect(
      schema.insertSystemSettingSchema.safeParse({
        tenant_id: 'default',
        category: 'a'.repeat(101),
        key: 'feature_flag',
        value_json: {},
      }).success,
    ).toBe(false);
  });

  it('validates upload blob and source document schemas', () => {
    expect(
      schema.insertFileBlobSchema.safeParse({
        tenant_id: 'tenant-1',
        sha256: 'a'.repeat(64),
        size_bytes: 1024,
        mime_type: 'application/pdf',
        storage_uri: 's3://bucket/archive/file.pdf',
      }).success,
    ).toBe(true);
    expect(
      schema.insertFileBlobSchema.safeParse({
        tenant_id: 'tenant-1',
        sha256: 'not-sha',
        size_bytes: 1024,
        mime_type: 'application/pdf',
        storage_uri: 's3://bucket/archive/file.pdf',
      }).success,
    ).toBe(false);

    const document = schema.insertSourceDocumentSchema.parse({
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      file_blob_id: null,
      filename: 'https-example',
      source_type: 'url',
      metadata_json: {
        source_url: 'https://example.com/doc',
        tags: ['auth'],
        processing_strategy: 'immediate',
      },
    });
    expect(document.status).toBe('uploaded');
    expect(document.metadata_json.processing_strategy).toBe('immediate');
    expect(schema.insertSourceDocumentSchema.safeParse({ ...document, status: 'failed' }).success).toBe(false);
    expect(
      schema.sourceDocumentMetadataSchema.safeParse({
        processing_strategy: 'manual',
      }).success,
    ).toBe(false);
  });

  it('requires tenant_id on all core business tables', () => {
    for (const table of tenantScopedTables) {
      expect(table.tenant_id.notNull).toBe(true);
    }
  });
});

describe('Wiki Zod validation', () => {
  it('validates insertWikiPageSchema inputs', () => {
    const parsed = schema.insertWikiPageSchema.parse({ ...validWikiPageInput, extra: 'ignored' });
    expect(parsed.status).toBe('draft');
    expect(Object.hasOwn(parsed, 'extra')).toBe(false);

    const missingTitle: Record<string, unknown> = { ...validWikiPageInput };
    delete missingTitle.title;
    expect(schema.insertWikiPageSchema.safeParse(missingTitle).success).toBe(false);
  });

  it('validates insertWikiPageVersionSchema inputs', () => {
    const parsed = schema.insertWikiPageVersionSchema.parse(validWikiPageVersionInput);
    expect(parsed.frontmatter_json).toEqual({});
    expect(parsed.status).toBe('draft');

    expect(schema.insertWikiPageVersionSchema.safeParse({ ...validWikiPageVersionInput, source: 'crawler' }).success).toBe(false);
  });

  it('validates publishRequestSchema inputs', () => {
    expect(schema.publishRequestSchema.safeParse({ version_id: 'version-1' }).success).toBe(true);
    expect(schema.publishRequestSchema.safeParse({ version_id: 'version-1', publish_note: 'Ready' }).success).toBe(true);
    expect(schema.publishRequestSchema.safeParse({ version_id: '' }).success).toBe(false);
  });

  it('validates rollbackRequestSchema inputs', () => {
    expect(schema.rollbackRequestSchema.safeParse({ target_version_id: 'version-1' }).success).toBe(true);
    expect(schema.rollbackRequestSchema.safeParse({ target_version_id: 'version-1', reason: 'Restore prior content' }).success).toBe(true);
    expect(schema.rollbackRequestSchema.safeParse({ target_version_id: '' }).success).toBe(false);
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
  schema.file_blobs,
  schema.source_documents,
  schema.wikiPages,
  schema.wikiPageVersions,
  schema.wikiSections,
  schema.sourceLinks,
] as const satisfies readonly { tenant_id: { notNull: boolean } }[];
