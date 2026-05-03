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

  it('validates wiki chunk and embedding insert schemas', () => {
    const validWikiChunk = {
      id: 'chunk-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      wiki_page_pk: 'wiki-page-pk-1',
      page_version_id: 'version-1',
      chunk_index: 0,
      content: 'Chunk content',
      content_hash: 'a'.repeat(64),
      token_count: 3,
      index_status: 'pending',
      source_chain_json: {},
      acl_json: {},
    };

    expect(schema.insertWikiChunkSchema.safeParse(validWikiChunk).success).toBe(true);

    const missingContent: Record<string, unknown> = { ...validWikiChunk };
    delete missingContent.content;
    expect(schema.insertWikiChunkSchema.safeParse(missingContent).success).toBe(false);
    expect(schema.insertWikiChunkSchema.safeParse({ ...validWikiChunk, index_status: 'failed' }).success).toBe(false);

    const validEmbedding = {
      id: 'embedding-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      chunk_id: 'chunk-1',
      model_config_id: 'model-config-1',
      embedding: [0.1, 0.2, 0.3],
    };

    expect(schema.insertEmbeddingSchema.safeParse(validEmbedding).success).toBe(true);

    const missingChunkId: Record<string, unknown> = { ...validEmbedding };
    delete missingChunkId.chunk_id;
    expect(schema.insertEmbeddingSchema.safeParse(missingChunkId).success).toBe(false);
  });

  it('validates index snapshot status lifecycle values', () => {
    expect(schema.indexSnapshotStatusSchema.safeParse('activated').success).toBe(true);
    expect(schema.indexSnapshotStatusSchema.safeParse('superseded').success).toBe(true);
    expect(schema.indexSnapshotStatusSchema.safeParse('active').success).toBe(false);
    expect(schema.indexSnapshotStatusSchema.safeParse('failed').success).toBe(false);
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

describe('Stage 5 Zod validation', () => {
  it('validates createGraphifyRunSchema inputs', () => {
    expect(schema.createGraphifyRunSchema.safeParse({ mode: 'full', trigger_type: 'manual' }).success).toBe(true);
    expect(
      schema.createGraphifyRunSchema.safeParse({
        mode: 'incremental',
        trigger_type: 'scheduled',
        input_scope: {
          page_ids: ['page-1'],
          source_document_ids: ['source-document-1'],
        },
        options: {
          wiki: false,
          no_viz: true,
          directed: true,
        },
      }).success,
    ).toBe(true);

    const parsedWithDefaultOptions = schema.createGraphifyRunSchema.parse({
      mode: 'update',
      trigger_type: 'auto',
      options: {},
    });
    expect(parsedWithDefaultOptions.options).toEqual({
      wiki: true,
      no_viz: false,
      directed: false,
    });

    expect(schema.createGraphifyRunSchema.safeParse({ mode: 'rebuild', trigger_type: 'manual' }).success).toBe(false);
    expect(schema.createGraphifyRunSchema.safeParse({ mode: 'full', trigger_type: 'webhook' }).success).toBe(false);
    expect(
      schema.createGraphifyRunSchema.safeParse({
        mode: 'full',
        trigger_type: 'manual',
        input_scope: {
          page_ids: Array.from({ length: 1001 }, (_, index) => `page-${index}`),
        },
      }).success,
    ).toBe(false);
    expect(
      schema.createGraphifyRunSchema.safeParse({
        mode: 'full',
        trigger_type: 'manual',
        input_scope: {
          source_document_ids: Array.from({ length: 1001 }, (_, index) => `source-document-${index}`),
        },
      }).success,
    ).toBe(false);
  });

  it('validates graphNodeSchema inputs', () => {
    const validNode = {
      node_key: 'node:auth',
      stable_key: 'stable:auth',
      label: 'Authentication',
    };

    expect(schema.graphNodeSchema.safeParse(validNode).success).toBe(true);
    expect(schema.graphNodeSchema.safeParse({ ...validNode, label: 'a'.repeat(257) }).success).toBe(false);

    const missingNodeKey: Record<string, unknown> = { ...validNode };
    delete missingNodeKey.node_key;
    expect(schema.graphNodeSchema.safeParse(missingNodeKey).success).toBe(false);
  });

  it('validates graphEdgeSchema inputs', () => {
    const validEdge = {
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      relation_type: 'depends_on',
      confidence_label: 'EXTRACTED',
    };

    expect(schema.graphEdgeSchema.safeParse(validEdge).success).toBe(true);
    expect(schema.graphEdgeSchema.safeParse({ ...validEdge, confidence_label: 'UNKNOWN' }).success).toBe(false);
    expect(schema.graphEdgeSchema.safeParse({ ...validEdge, raw_confidence_score: 1.2 }).success).toBe(false);
  });

  it('validates graphCommunitySchema inputs', () => {
    expect(
      schema.graphCommunitySchema.safeParse({
        community_key: 'community:platform',
        label: 'Platform',
        summary: 'Platform services',
      }).success,
    ).toBe(true);

    expect(
      schema.graphCommunitySchema.safeParse({
        community_key: 'community:platform',
        label: null,
        summary: null,
      }).success,
    ).toBe(true);
  });

  it('validates pageBlockMetadataSchema inputs', () => {
    const validBlock = {
      block_id: 'block-1',
      owner: 'graphify',
      content_hash: 'sha256:abc',
    };

    expect(schema.pageBlockMetadataSchema.safeParse(validBlock).success).toBe(true);
    expect(schema.pageBlockMetadataSchema.safeParse({ ...validBlock, owner: 'graphify:managed' }).success).toBe(false);
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
  schema.graphifyRuns,
  schema.graphNodes,
  schema.graphEdges,
  schema.graphCommunities,
  schema.graphNodeAliases,
  schema.graphNodeMerges,
  schema.graphReports,
  schema.pageBlockMetadata,
  schema.graphEvidenceRefs,
  schema.wikiUpdateProposals,
  schema.indexSnapshots,
  schema.wikiChunks,
  schema.embeddings,
] as const satisfies readonly { tenant_id: { notNull: boolean } }[];
