import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { z as z4 } from 'zod/v4';

import { embeddings, wikiChunks } from './core.js';

export const userRoleSchema = z.enum(['owner', 'admin', 'space_admin', 'editor', 'viewer', 'auditor']);
export const userStatusSchema = z.enum(['active', 'disabled']);
export const spaceStatusSchema = z.enum(['active', 'archived']);
export const modelTypeSchema = z.enum(['chat', 'embedding', 'rerank']);
export const sourceDocumentSourceTypeSchema = z.enum(['upload', 'url']);
export const sourceDocumentStatusSchema = z.enum([
  'uploaded',
  'validating',
  'archived',
  'parsing',
  'parsed',
  'parse_failed',
  'security_rejected',
  'graphify_pending',
  'graphify_running',
  'wiki_proposed',
  'published',
  'indexed',
  'graphify_failed',
  'sync_failed',
  'index_failed',
]);
export const sourceDocumentProcessingStrategySchema = z.enum(['immediate', 'stash', 'archive_only']);
export const graphifyRunModeSchema = z.enum(['full', 'update', 'incremental']);
export const graphifyRunStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export const graphifyTriggerTypeSchema = z.enum(['manual', 'scheduled', 'auto']);
export const confidenceLabelSchema = z.enum(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);
export const blockOwnerSchema = z.enum(['graphify', 'human']);
export const proposalTypeSchema = z.enum(['conflict', 'deprecation', 'new_page']);
export const proposalStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export const indexSnapshotStatusSchema = z.enum(['building', 'ready', 'activated', 'superseded']);
export const chunkIndexStatusSchema = z4.enum(['pending', 'indexed']);

const nonEmptyString = z.string().trim().min(1);
const idSchema = nonEmptyString.max(200);
const optionalIdSchema = z.string().max(200);
const emailSchema = z.string().trim().email().max(254);
const displayNameSchema = nonEmptyString.max(200);
const optionalDisplayNameSchema = z.string().max(200);
const nameSchema = nonEmptyString.max(200);
const descriptionSchema = z.string().max(5000);
const passwordSchema = z.string().min(8).max(128);
const slugSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const providerSchema = nonEmptyString.max(200);
const modelIdSchema = nonEmptyString.max(200);
const baseUrlSchema = z.string().url().max(2048);
const encryptedApiKeyRefSchema = z.string().max(500);
const visibleGroupIdsSchema = z.array(z.string()).max(100);
const requestMetadataStringSchema = z.string().max(500);
const shortTextSchema = nonEmptyString.max(100);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const filenameSchema = nonEmptyString.max(500);
const storageUriSchema = nonEmptyString.max(4096);
const mimeTypeSchema = nonEmptyString.max(255);
const metadataObjectSchema = z.record(z.unknown());

// Accept unstructured JSON object records here; feature-specific schemas own deeper shape validation.
const unstructuredJsonRecordSchema = z.record(z.unknown());

export const sourceDocumentMetadataSchema = z
  .object({
    source_url: z.string().url().max(2048).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    author: z.string().trim().max(200).optional(),
    processing_strategy: sourceDocumentProcessingStrategySchema.optional(),
    batch_id: z.string().trim().min(1).max(200).optional(),
    rejection_reason: z.string().trim().max(100).optional(),
    rejection_details: metadataObjectSchema.optional(),
    injection_risk: z.boolean().optional(),
    injection_patterns: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    needs_attention: z.boolean().optional(),
    fetch_metadata: metadataObjectSchema.optional(),
    parse_metadata: metadataObjectSchema.optional(),
    graphify_run_id: z.string().trim().min(1).max(200).optional(),
    cleanup_at: z.string().datetime().optional(),
  })
  .passthrough();

export const insertUserSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  email: emailSchema,
  display_name: displayNameSchema,
  password: passwordSchema,
  role: userRoleSchema.default('viewer'),
  status: userStatusSchema.default('active'),
});

export const updateUserSchema = z
  .object({
    email: emailSchema.optional(),
    display_name: displayNameSchema.optional(),
    password: passwordSchema.optional(),
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .partial();

export const insertSpaceSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  name: nameSchema,
  slug: slugSchema,
  description: descriptionSchema.optional(),
  status: spaceStatusSchema.default('active'),
  strict_knowledge_only: z.boolean().default(true),
  graphify_config: unstructuredJsonRecordSchema.default({}),
  default_publish_policy: shortTextSchema.default('editor_publish'),
});

export const updateSpaceSchema = z
  .object({
    name: nameSchema.optional(),
    slug: slugSchema.optional(),
    description: descriptionSchema.optional(),
    status: spaceStatusSchema.optional(),
    strict_knowledge_only: z.boolean().optional(),
    graphify_config: unstructuredJsonRecordSchema.optional(),
    default_publish_policy: shortTextSchema.optional(),
  })
  .partial();

export const insertModelConfigSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  provider: providerSchema,
  model_id: modelIdSchema,
  model_type: modelTypeSchema,
  display_name: optionalDisplayNameSchema.optional(),
  base_url: baseUrlSchema.optional(),
  encrypted_api_key_ref: encryptedApiKeyRefSchema.optional(),
  embedding_dim: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  rate_limit_rpm: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
  visible_group_ids: visibleGroupIdsSchema.default([]),
});

export const updateModelConfigSchema = z
  .object({
    provider: providerSchema.optional(),
    model_id: modelIdSchema.optional(),
    model_type: modelTypeSchema.optional(),
    display_name: optionalDisplayNameSchema.optional(),
    base_url: baseUrlSchema.optional(),
    encrypted_api_key_ref: encryptedApiKeyRefSchema.optional(),
    embedding_dim: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    rate_limit_rpm: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
    visible_group_ids: visibleGroupIdsSchema.optional(),
  })
  .partial();

export const insertGroupSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
});

export const updateGroupSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .partial();

export const insertSessionSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  user_id: idSchema,
  refresh_token_hash: nonEmptyString.max(500),
  ip: requestMetadataStringSchema.optional(),
  user_agent: requestMetadataStringSchema.optional(),
  expires_at: z.coerce.date(),
});

export const insertAuditLogSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  actor_user_id: optionalIdSchema.optional(),
  action: shortTextSchema,
  resource_type: shortTextSchema,
  resource_id: optionalIdSchema.optional(),
  space_id: optionalIdSchema.optional(),
  ip: requestMetadataStringSchema.optional(),
  user_agent: requestMetadataStringSchema.optional(),
  request_id: requestMetadataStringSchema.optional(),
  metadata_json: unstructuredJsonRecordSchema.default({}),
});

export const insertSystemSettingSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  category: shortTextSchema,
  key: shortTextSchema,
  value_json: unstructuredJsonRecordSchema,
  updated_by: optionalIdSchema.optional(),
});

export const insertFileBlobSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  sha256: sha256Schema,
  size_bytes: z.number().int().nonnegative(),
  mime_type: mimeTypeSchema,
  storage_uri: storageUriSchema,
});

export const insertSourceDocumentSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  space_id: idSchema,
  file_blob_id: optionalIdSchema.nullable().optional(),
  filename: filenameSchema,
  uploader_id: optionalIdSchema.nullable().optional(),
  source_type: sourceDocumentSourceTypeSchema.default('upload'),
  classification: shortTextSchema.nullable().optional(),
  status: sourceDocumentStatusSchema.default('uploaded'),
  parsed_uri: storageUriSchema.nullable().optional(),
  metadata_json: sourceDocumentMetadataSchema.default({}),
});

export const updateSourceDocumentSchema = z
  .object({
    file_blob_id: optionalIdSchema.nullable().optional(),
    filename: filenameSchema.optional(),
    classification: shortTextSchema.nullable().optional(),
    status: sourceDocumentStatusSchema.optional(),
    parsed_uri: storageUriSchema.nullable().optional(),
    metadata_json: sourceDocumentMetadataSchema.optional(),
  })
  .partial();

export const wikiPageStatusSchema = z.enum(['draft', 'published', 'archived']);
export const wikiVersionSourceSchema = z.enum(['graphify', 'human', 'import', 'rollback']);

export const insertWikiPageSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  space_id: idSchema,
  page_id: nonEmptyString.max(500),
  title: nonEmptyString.max(500),
  slug: nonEmptyString.max(500),
  status: wikiPageStatusSchema.default('draft'),
  created_by: optionalIdSchema.nullable().optional(),
});

export const insertWikiPageVersionSchema = z.object({
  id: optionalIdSchema.optional(),
  tenant_id: idSchema,
  space_id: idSchema,
  wiki_page_pk: idSchema,
  page_id: nonEmptyString.max(500),
  version_no: z.number().int().positive(),
  content_markdown: z.string(),
  frontmatter_json: unstructuredJsonRecordSchema.default({}),
  source: wikiVersionSourceSchema,
  graphify_run_id: optionalIdSchema.nullable().optional(),
  commit_hash: z.string().max(200).nullable().optional(),
  status: wikiPageStatusSchema.default('draft'),
  created_by: optionalIdSchema.nullable().optional(),
});

export const publishRequestSchema = z.object({
  version_id: nonEmptyString.max(200),
  publish_note: z.string().max(1000).optional(),
});

export const rollbackRequestSchema = z.object({
  target_version_id: nonEmptyString.max(200),
  reason: z.string().max(1000).optional(),
});

export const createGraphifyRunSchema = z.object({
  mode: graphifyRunModeSchema,
  trigger_type: graphifyTriggerTypeSchema,
  input_scope: z
    .object({
      page_ids: z.array(idSchema).max(1000).optional(),
      source_document_ids: z.array(idSchema).max(1000).optional(),
    })
    .optional(),
  options: z
    .object({
      wiki: z.boolean().default(true),
      no_viz: z.boolean().default(false),
      directed: z.boolean().default(false),
    })
    .optional(),
});

export const graphNodeSchema = z.object({
  node_key: nonEmptyString.max(500),
  stable_key: nonEmptyString.max(500),
  label: nonEmptyString.max(256),
  norm_label: z.string().max(256).nullable().optional(),
  type: z.string().max(100).nullable().optional(),
  community_id: z.string().max(200).nullable().optional(),
});

export const graphEdgeSchema = z.object({
  source_node_id: idSchema,
  target_node_id: idSchema,
  relation_type: nonEmptyString.max(500),
  confidence_label: confidenceLabelSchema,
  raw_confidence_score: z.number().min(0).max(1).nullable().optional(),
  effective_confidence_score: z.number().min(0).max(1).nullable().optional(),
  evidence_count: z.number().int().nonnegative().default(1),
});

export const graphCommunitySchema = z.object({
  community_key: nonEmptyString.max(500),
  label: z.string().max(500).nullable().optional(),
  summary: z.string().max(10000).nullable().optional(),
  node_count: z.number().int().nonnegative().default(0),
});

export const pageBlockMetadataSchema = z.object({
  block_id: nonEmptyString.max(500),
  owner: blockOwnerSchema,
  content_hash: nonEmptyString.max(200),
  editable: z.boolean().default(false),
});

const jsonObjectSchemaV4 = z4.record(z4.string(), z4.unknown());

export const insertWikiChunkSchema = createInsertSchema(wikiChunks, {
  index_status: chunkIndexStatusSchema,
  source_chain_json: jsonObjectSchemaV4,
  acl_json: jsonObjectSchemaV4,
});
export const selectWikiChunkSchema = createSelectSchema(wikiChunks, {
  index_status: chunkIndexStatusSchema,
  source_chain_json: jsonObjectSchemaV4,
  acl_json: jsonObjectSchemaV4,
});

export const insertEmbeddingSchema = createInsertSchema(embeddings, {
  embedding: z4.array(z4.number()),
});
export const selectEmbeddingSchema = createSelectSchema(embeddings, {
  embedding: z4.array(z4.number()),
});

export type InsertUserInput = z.infer<typeof insertUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type InsertSpaceInput = z.infer<typeof insertSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;
export type InsertModelConfigInput = z.infer<typeof insertModelConfigSchema>;
export type UpdateModelConfigInput = z.infer<typeof updateModelConfigSchema>;
export type InsertGroupInput = z.infer<typeof insertGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type InsertSessionInput = z.infer<typeof insertSessionSchema>;
export type InsertAuditLogInput = z.infer<typeof insertAuditLogSchema>;
export type InsertSystemSettingInput = z.infer<typeof insertSystemSettingSchema>;
export type SourceDocumentStatus = z.infer<typeof sourceDocumentStatusSchema>;
export type SourceDocumentSourceType = z.infer<typeof sourceDocumentSourceTypeSchema>;
export type SourceDocumentProcessingStrategy = z.infer<typeof sourceDocumentProcessingStrategySchema>;
export type SourceDocumentMetadata = z.infer<typeof sourceDocumentMetadataSchema>;
export type InsertFileBlobInput = z.infer<typeof insertFileBlobSchema>;
export type InsertSourceDocumentInput = z.infer<typeof insertSourceDocumentSchema>;
export type UpdateSourceDocumentInput = z.infer<typeof updateSourceDocumentSchema>;
export type WikiPageStatus = z.infer<typeof wikiPageStatusSchema>;
export type WikiVersionSource = z.infer<typeof wikiVersionSourceSchema>;
export type InsertWikiPageInput = z.infer<typeof insertWikiPageSchema>;
export type InsertWikiPageVersionInput = z.infer<typeof insertWikiPageVersionSchema>;
export type PublishRequestInput = z.infer<typeof publishRequestSchema>;
export type RollbackRequestInput = z.infer<typeof rollbackRequestSchema>;
export type GraphifyRunMode = z.infer<typeof graphifyRunModeSchema>;
export type GraphifyRunStatus = z.infer<typeof graphifyRunStatusSchema>;
export type GraphifyTriggerType = z.infer<typeof graphifyTriggerTypeSchema>;
export type ConfidenceLabel = z.infer<typeof confidenceLabelSchema>;
export type BlockOwner = z.infer<typeof blockOwnerSchema>;
export type ProposalType = z.infer<typeof proposalTypeSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type IndexSnapshotStatus = z.infer<typeof indexSnapshotStatusSchema>;
export type ChunkIndexStatus = z4.infer<typeof chunkIndexStatusSchema>;
export type CreateGraphifyRunInput = z.infer<typeof createGraphifyRunSchema>;
export type GraphNodeInput = z.infer<typeof graphNodeSchema>;
export type GraphEdgeInput = z.infer<typeof graphEdgeSchema>;
export type GraphCommunityInput = z.infer<typeof graphCommunitySchema>;
export type PageBlockMetadataInput = z.infer<typeof pageBlockMetadataSchema>;
export type InsertWikiChunkInput = z4.infer<typeof insertWikiChunkSchema>;
export type SelectWikiChunkInput = z4.infer<typeof selectWikiChunkSchema>;
export type InsertEmbeddingInput = z4.infer<typeof insertEmbeddingSchema>;
export type SelectEmbeddingInput = z4.infer<typeof selectEmbeddingSchema>;
