import { z } from 'zod';

export const userRoleSchema = z.enum(['owner', 'admin', 'space_admin', 'editor', 'viewer', 'auditor']);
export const modelTypeSchema = z.enum(['chat', 'embedding', 'rerank']);

const nonEmptyString = z.string().trim().min(1);
const slugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const statusSchema = z.string().trim().min(1);
const jsonRecordSchema = z.record(z.unknown());

export const insertUserSchema = z.object({
  id: z.string().optional(),
  tenant_id: nonEmptyString,
  email: z.string().trim().email(),
  display_name: nonEmptyString,
  password: z.string().min(8),
  role: userRoleSchema.default('viewer'),
  status: statusSchema.default('active'),
});

export const updateUserSchema = z
  .object({
    email: z.string().trim().email().optional(),
    display_name: nonEmptyString.optional(),
    password: z.string().min(8).optional(),
    role: userRoleSchema.optional(),
    status: statusSchema.optional(),
  })
  .partial();

export const insertSpaceSchema = z.object({
  id: z.string().optional(),
  tenant_id: nonEmptyString,
  name: nonEmptyString,
  slug: slugSchema,
  description: z.string().optional(),
  status: statusSchema.default('active'),
  wiki_repo_path: nonEmptyString.optional(),
  strict_knowledge_only: z.boolean().default(true),
  graphify_config: jsonRecordSchema.default({}),
  default_publish_policy: statusSchema.default('editor_publish'),
});

export const updateSpaceSchema = z
  .object({
    name: nonEmptyString.optional(),
    slug: slugSchema.optional(),
    description: z.string().optional(),
    status: statusSchema.optional(),
    wiki_repo_path: nonEmptyString.optional(),
    strict_knowledge_only: z.boolean().optional(),
    graphify_config: jsonRecordSchema.optional(),
    default_publish_policy: statusSchema.optional(),
  })
  .partial();

export const insertModelConfigSchema = z.object({
  id: z.string().optional(),
  tenant_id: nonEmptyString,
  provider: nonEmptyString,
  model_id: nonEmptyString,
  model_type: modelTypeSchema,
  display_name: z.string().optional(),
  base_url: z.string().url().optional(),
  encrypted_api_key_ref: z.string().optional(),
  embedding_dim: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  rate_limit_rpm: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
  visible_group_ids: z.array(z.string()).default([]),
});

export const updateModelConfigSchema = z
  .object({
    provider: nonEmptyString.optional(),
    model_id: nonEmptyString.optional(),
    model_type: modelTypeSchema.optional(),
    display_name: z.string().optional(),
    base_url: z.string().url().optional(),
    encrypted_api_key_ref: z.string().optional(),
    embedding_dim: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
    rate_limit_rpm: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
    visible_group_ids: z.array(z.string()).optional(),
  })
  .partial();

export const insertGroupSchema = z.object({
  id: z.string().optional(),
  tenant_id: nonEmptyString,
  name: nonEmptyString,
  description: z.string().optional(),
});

export const updateGroupSchema = z
  .object({
    name: nonEmptyString.optional(),
    description: z.string().optional(),
  })
  .partial();

export const insertSessionSchema = z.object({
  id: z.string().optional(),
  tenant_id: nonEmptyString,
  user_id: nonEmptyString,
  refresh_token_hash: nonEmptyString,
  ip: z.string().optional(),
  user_agent: z.string().optional(),
  expires_at: z.coerce.date(),
});

export const insertAuditLogSchema = z.object({
  id: z.string().optional(),
  tenant_id: nonEmptyString,
  actor_user_id: z.string().optional(),
  action: nonEmptyString,
  resource_type: nonEmptyString,
  resource_id: z.string().optional(),
  space_id: z.string().optional(),
  ip: z.string().optional(),
  user_agent: z.string().optional(),
  request_id: z.string().optional(),
  metadata_json: jsonRecordSchema.default({}),
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
