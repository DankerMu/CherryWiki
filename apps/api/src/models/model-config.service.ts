import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode, model_configs, tenants } from '@cherrygraph/shared';
import { and, asc, count, desc, eq, ne, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { AUDIT_EVENTS } from '../audit/audit-events.js';
import { AuditService } from '../audit/audit.service.js';
import {
  buildPaginationMeta,
  paginatedResponse,
  parseSortField,
  type PaginatedResponse,
} from '../common/dto/pagination.dto.js';
import {
  sanitizeOutboundProbeError,
  validateAdminOutboundProbeUrl,
} from '../common/outbound-probe-safety.js';
import { DRIZZLE } from '../database/drizzle.constants.js';

type ModelConfigDatabase = NodePgDatabase;
type ModelConfigRow = typeof model_configs.$inferSelect;
type ModelConfigInsert = typeof model_configs.$inferInsert;
type ModelType = 'chat' | 'embedding' | 'rerank';
type ModelStatus = 'active' | 'disabled';
type ProbeRequest = {
  path: string;
  body: unknown;
};

const MODEL_PROBE_TIMEOUT_MS = 10000;

export type AdminContext = {
  tenantId?: string;
  actorUserId?: string;
};

export type ListModelsInput = {
  page?: number;
  per_page?: number;
  sort?: string;
};

export type CreateModelConfigInput = {
  provider: string;
  model_id: string;
  model_type: ModelType;
  display_name?: string;
  base_url?: string;
  encrypted_api_key_ref?: string;
  embedding_dim?: number;
  max_tokens?: number;
  rate_limit_rpm?: number;
  enabled?: boolean;
  visible_group_ids?: string[];
};

export type UpdateModelConfigInput = {
  provider?: string;
  model_id?: string;
  model_type?: ModelType;
  display_name?: string;
  base_url?: string;
  encrypted_api_key_ref?: string;
  embedding_dim?: number;
  max_tokens?: number;
  rate_limit_rpm?: number;
  enabled?: boolean;
  visible_group_ids?: string[];
};

export type TestModelConnectivityInput = {
  test_prompt?: string;
};

export type AdminModelConfigResponse = {
  id: string;
  name: string | null;
  provider: string;
  model_id: string;
  model_type: string;
  status: ModelStatus;
  config: {
    base_url: string | null;
    embedding_dim: number | null;
    max_tokens: number | null;
    rate_limit_rpm: number | null;
  };
  visible_group_ids: string[];
};

export type ModelConnectivityTestResponse = {
  reachable: boolean;
  latency_ms: number;
  error?: string;
};

type ModelSortField = keyof Pick<
  typeof model_configs,
  'created_at' | 'updated_at' | 'provider' | 'model_id' | 'model_type' | 'display_name' | 'enabled'
>;

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;
const VALID_MODEL_TYPES = new Set<ModelType>(['chat', 'embedding', 'rerank']);

@Injectable()
export class ModelConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: ModelConfigDatabase,
    private readonly auditService: AuditService,
  ) {}

  async listModels(
    input: ListModelsInput = {},
    context: AdminContext = {},
  ): Promise<PaginatedResponse<AdminModelConfigResponse>> {
    const tenantId = await this.resolveTenantId(context);
    const page = normalizePage(input.page);
    const perPage = normalizePerPage(input.per_page);
    const order = buildModelOrder(input.sort ?? '-created_at');

    const rows = await this.db
      .select()
      .from(model_configs)
      .where(eq(model_configs.tenant_id, tenantId))
      .orderBy(order)
      .limit(perPage)
      .offset((page - 1) * perPage);
    const [countRow] = await this.db
      .select({ total: count() })
      .from(model_configs)
      .where(eq(model_configs.tenant_id, tenantId));

    return paginatedResponse(
      rows.map(toAdminModelConfigResponse),
      buildPaginationMeta(page, perPage, normalizeCount(countRow?.total)),
    );
  }

  async createModel(
    input: CreateModelConfigInput,
    context: AdminContext = {},
  ): Promise<AdminModelConfigResponse> {
    const tenantId = await this.resolveTenantId(context);
    const provider = normalizeRequiredString(input.provider);
    const modelId = normalizeRequiredString(input.model_id);
    const modelType = normalizeModelTypeOrThrow(input.model_type);
    const enabled = input.enabled ?? true;
    const visibleGroupIds = normalizeIdList(input.visible_group_ids ?? []);

    const existing = await findModelByProviderModelId(this.db, tenantId, provider, modelId);
    if (existing !== undefined) {
      throwApiError(ErrorCode.MODEL_NAME_CONFLICT, 'Model already exists', HttpStatus.CONFLICT);
    }

    if (modelType === 'embedding' && enabled) {
      await assertSingleEnabledEmbedding(this.db, tenantId);
    }

    const apiKeyRef = normalizeOptionalString(input.encrypted_api_key_ref);
    if (apiKeyRef !== null) {
      validateSecretRefFormat(apiKeyRef);
    }

    const now = new Date();

    try {
      const [created] = await this.db
        .insert(model_configs)
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          provider,
          model_id: modelId,
          model_type: modelType,
          display_name: normalizeOptionalString(input.display_name),
          base_url: normalizeOptionalString(input.base_url),
          encrypted_api_key_ref: apiKeyRef,
          embedding_dim: input.embedding_dim ?? null,
          max_tokens: input.max_tokens ?? null,
          rate_limit_rpm: input.rate_limit_rpm ?? null,
          enabled,
          visible_group_ids: visibleGroupIds,
          created_at: now,
          updated_at: now,
        })
        .returning();

      if (created === undefined) {
        throw new Error('Failed to create model config');
      }

      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.ADMIN_MODEL_CREATE,
        resource_type: 'model_config',
        resource_id: created.id,
        metadata_json: {
          provider: created.provider,
          model_id: created.model_id,
          model_type: created.model_type,
          enabled: created.enabled,
          visible_group_ids: normalizeVisibleGroupIds(created.visible_group_ids),
        },
      });

      return toAdminModelConfigResponse(created);
    } catch (err) {
      if (isUniqueViolation(err, 'model_configs_tenant_id_provider_model_id_unique')) {
        throwApiError(ErrorCode.MODEL_NAME_CONFLICT, 'Model already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }
  }

  async updateModel(
    modelConfigId: string,
    input: UpdateModelConfigInput,
    context: AdminContext = {},
  ): Promise<AdminModelConfigResponse> {
    const tenantId = await this.resolveTenantId(context);
    const existing = await findModelById(this.db, tenantId, modelConfigId);
    if (existing === undefined) {
      throwModelNotFound();
    }

    const nextProvider = input.provider !== undefined ? normalizeRequiredString(input.provider) : existing.provider;
    const nextModelId = input.model_id !== undefined ? normalizeRequiredString(input.model_id) : existing.model_id;
    const nextModelType =
      input.model_type !== undefined ? normalizeModelTypeOrThrow(input.model_type) : normalizeModelTypeOrThrow(existing.model_type);
    const nextEnabled = input.enabled ?? existing.enabled;

    if (nextProvider !== existing.provider || nextModelId !== existing.model_id) {
      const conflicting = await findModelByProviderModelId(this.db, tenantId, nextProvider, nextModelId);
      if (conflicting !== undefined && conflicting.id !== existing.id) {
        throwApiError(ErrorCode.MODEL_NAME_CONFLICT, 'Model already exists', HttpStatus.CONFLICT);
      }
    }

    if (nextModelType === 'embedding' && nextEnabled) {
      await assertSingleEnabledEmbedding(this.db, tenantId, existing.id);
    }

    const updateValues: Partial<ModelConfigInsert> = {
      updated_at: new Date(),
    };
    const changedFields: string[] = [];

    if (nextProvider !== existing.provider) {
      updateValues.provider = nextProvider;
      changedFields.push('provider');
    }

    if (nextModelId !== existing.model_id) {
      updateValues.model_id = nextModelId;
      changedFields.push('model_id');
    }

    if (nextModelType !== existing.model_type) {
      updateValues.model_type = nextModelType;
      changedFields.push('model_type');
    }

    if (input.display_name !== undefined) {
      const displayName = normalizeOptionalString(input.display_name);
      if (displayName !== existing.display_name) {
        updateValues.display_name = displayName;
        changedFields.push('display_name');
      }
    }

    if (input.base_url !== undefined) {
      const baseUrl = normalizeOptionalString(input.base_url);
      if (baseUrl !== existing.base_url) {
        updateValues.base_url = baseUrl;
        changedFields.push('base_url');
      }
    }

    if (input.encrypted_api_key_ref !== undefined) {
      const encryptedApiKeyRef = normalizeOptionalString(input.encrypted_api_key_ref);
      if (encryptedApiKeyRef !== null) {
        validateSecretRefFormat(encryptedApiKeyRef);
      }
      if (encryptedApiKeyRef !== existing.encrypted_api_key_ref) {
        updateValues.encrypted_api_key_ref = encryptedApiKeyRef;
        changedFields.push('encrypted_api_key_ref');
      }
    }

    if (input.embedding_dim !== undefined && input.embedding_dim !== existing.embedding_dim) {
      updateValues.embedding_dim = input.embedding_dim;
      changedFields.push('embedding_dim');
    }

    if (input.max_tokens !== undefined && input.max_tokens !== existing.max_tokens) {
      updateValues.max_tokens = input.max_tokens;
      changedFields.push('max_tokens');
    }

    if (input.rate_limit_rpm !== undefined && input.rate_limit_rpm !== existing.rate_limit_rpm) {
      updateValues.rate_limit_rpm = input.rate_limit_rpm;
      changedFields.push('rate_limit_rpm');
    }

    if (input.enabled !== undefined && input.enabled !== existing.enabled) {
      updateValues.enabled = input.enabled;
      changedFields.push('enabled');
    }

    if (input.visible_group_ids !== undefined) {
      const visibleGroupIds = normalizeIdList(input.visible_group_ids);
      if (!arraysEqual(visibleGroupIds, normalizeVisibleGroupIds(existing.visible_group_ids))) {
        updateValues.visible_group_ids = visibleGroupIds;
        changedFields.push('visible_group_ids');
      }
    }

    if (changedFields.length === 0) {
      return toAdminModelConfigResponse(existing);
    }

    try {
      const [updated] = await this.db
        .update(model_configs)
        .set(updateValues)
        .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, modelConfigId)))
        .returning();
      const updatedModel = updated ?? applyModelConfigFallback(existing, updateValues);

      this.auditService.push({
        tenant_id: tenantId,
        ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
        action: AUDIT_EVENTS.ADMIN_MODEL_UPDATE,
        resource_type: 'model_config',
        resource_id: modelConfigId,
        metadata_json: {
          changed_fields: changedFields,
          old_status: toModelStatus(existing.enabled),
          new_status: toModelStatus(updatedModel.enabled),
        },
      });

      return toAdminModelConfigResponse(updatedModel);
    } catch (err) {
      if (isUniqueViolation(err, 'model_configs_tenant_id_provider_model_id_unique')) {
        throwApiError(ErrorCode.MODEL_NAME_CONFLICT, 'Model already exists', HttpStatus.CONFLICT);
      }

      throw err;
    }
  }

  async testConnectivity(
    modelConfigId: string,
    input: TestModelConnectivityInput = {},
    context: AdminContext = {},
  ): Promise<ModelConnectivityTestResponse> {
    void input;

    const tenantId = await this.resolveTenantId(context);
    const existing = await findModelById(this.db, tenantId, modelConfigId);
    if (existing === undefined) {
      throwModelNotFound();
    }

    const startedAt = Date.now();
    let result: ModelConnectivityTestResponse;

    let apiKey: string;
    try {
      apiKey = this.resolveApiKey(existing.encrypted_api_key_ref);
    } catch {
      result = {
        reachable: false,
        latency_ms: elapsedMs(startedAt),
        error: 'No API key configured',
      };

      this.auditModelTest(tenantId, existing, result, context);
      return result;
    }

    const baseUrl = resolveModelBaseUrl(existing);
    if (baseUrl === null) {
      result = {
        reachable: false,
        latency_ms: elapsedMs(startedAt),
        error: 'No base URL configured',
      };

      this.auditModelTest(tenantId, existing, result, context);
      return result;
    }

    const targetValidation = await validateAdminOutboundProbeUrl(baseUrl, {
      dnsTimeoutMs: remainingDeadlineMs(startedAt, MODEL_PROBE_TIMEOUT_MS),
    });
    if (!targetValidation.ok) {
      result = {
        reachable: false,
        latency_ms: elapsedMs(startedAt),
        error: targetValidation.error,
      };

      this.auditModelTest(tenantId, existing, result, context);
      return result;
    }

    try {
      const remainingMs = remainingDeadlineMs(startedAt, MODEL_PROBE_TIMEOUT_MS);
      if (remainingMs <= 0) {
        await targetValidation.dispatcher.close().catch(() => undefined);
        result = {
          reachable: false,
          latency_ms: elapsedMs(startedAt),
          error: 'Request timed out (10s total)',
        };

        this.auditModelTest(tenantId, existing, result, context);
        return result;
      }

      const response = await probeModelEndpoint(
        targetValidation.url.toString(),
        apiKey,
        existing.model_id,
        normalizeModelTypeOrThrow(existing.model_type),
        remainingMs,
        targetValidation.dispatcher,
      );
      const latencyMs = elapsedMs(startedAt);

      if (response.ok) {
        result = {
          reachable: true,
          latency_ms: latencyMs,
        };
      } else if (response.status === 401 || response.status === 403) {
        result = {
          reachable: false,
          latency_ms: latencyMs,
          error: `Authentication failed (HTTP ${response.status})`,
        };
      } else {
        result = {
          reachable: false,
          latency_ms: latencyMs,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (err) {
      if (isAbortError(err)) {
        result = {
          reachable: false,
          latency_ms: elapsedMs(startedAt),
          error: 'Request timed out (10s total)',
        };
      } else {
        result = {
          reachable: false,
          latency_ms: elapsedMs(startedAt),
          error: sanitizeOutboundProbeError(err, [apiKey]),
        };
      }
    }

    await targetValidation.dispatcher.close().catch(() => undefined);
    this.auditModelTest(tenantId, existing, result, context);
    return result;
  }

  resolveApiKey(encryptedApiKeyRef: string | null): string {
    const secretName = parseSecretRef(encryptedApiKeyRef);
    const apiKey = process.env[secretName.toUpperCase()];
    if (apiKey === undefined || apiKey.trim().length === 0) {
      throwApiError(ErrorCode.SECRET_NOT_FOUND, 'Secret not found', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return apiKey;
  }

  private async resolveTenantId(context: AdminContext): Promise<string> {
    if (context.tenantId !== undefined && context.tenantId.trim().length > 0) {
      return context.tenantId.trim();
    }

    const configuredTenantId = process.env.DEFAULT_TENANT_ID;
    if (configuredTenantId !== undefined && configuredTenantId.trim().length > 0) {
      return configuredTenantId.trim();
    }

    const [tenant] = await this.db.select({ id: tenants.id }).from(tenants).limit(1);
    if (tenant === undefined) {
      throw new Error('No tenant configured');
    }

    return tenant.id;
  }

  private auditModelTest(
    tenantId: string,
    model: ModelConfigRow,
    result: ModelConnectivityTestResponse,
    context: AdminContext,
  ): void {
    this.auditService.push({
      tenant_id: tenantId,
      ...(context.actorUserId !== undefined ? { actor_user_id: context.actorUserId } : {}),
      action: AUDIT_EVENTS.ADMIN_MODEL_TEST,
      resource_type: 'model_config',
      resource_id: model.id,
      metadata_json: {
        model_id: model.model_id,
        provider: model.provider,
        reachable: result.reachable,
        error: result.error,
      },
    });
  }
}

async function findModelById(
  db: ModelConfigDatabase,
  tenantId: string,
  modelConfigId: string,
): Promise<ModelConfigRow | undefined> {
  const [model] = await db
    .select()
    .from(model_configs)
    .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, modelConfigId)))
    .limit(1);

  return model;
}

type ProbeResult = { ok: boolean; status: number };

async function probeModelEndpoint(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  modelType: ModelType,
  timeoutMs: number,
  dispatcher: NonNullable<RequestInit['dispatcher']>,
): Promise<ProbeResult> {
  const request = buildProbeRequest(modelId, modelType);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${request.path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
      dispatcher,
    });
    const result = { ok: response.ok, status: response.status };
    await response.body?.cancel().catch(() => undefined);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function buildProbeRequest(modelId: string, modelType: ModelType): ProbeRequest {
  switch (modelType) {
    case 'chat':
      return {
        path: '/chat/completions',
        body: {
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
      };
    case 'embedding':
      return {
        path: '/embeddings',
        body: {
          model: modelId,
          input: 'test',
        },
      };
    case 'rerank':
      return {
        path: '/rerank',
        body: {
          model: modelId,
          query: 'test',
          documents: ['test'],
        },
      };
  }
}

function resolveModelBaseUrl(model: ModelConfigRow): string | null {
  const modelBaseUrl = model.base_url?.trim();
  if (modelBaseUrl !== undefined && modelBaseUrl.length > 0) {
    return modelBaseUrl;
  }

  const envBaseUrl = process.env.MODEL_API_BASE_URL?.trim();
  return envBaseUrl !== undefined && envBaseUrl.length > 0 ? envBaseUrl : null;
}

async function findModelByProviderModelId(
  db: ModelConfigDatabase,
  tenantId: string,
  provider: string,
  modelId: string,
): Promise<ModelConfigRow | undefined> {
  const [model] = await db
    .select()
    .from(model_configs)
    .where(
      and(
        eq(model_configs.tenant_id, tenantId),
        eq(model_configs.provider, provider),
        eq(model_configs.model_id, modelId),
      ),
    )
    .limit(1);

  return model;
}

async function assertSingleEnabledEmbedding(
  db: ModelConfigDatabase,
  tenantId: string,
  excludeModelConfigId?: string,
): Promise<void> {
  const conditions: SQL[] = [
    eq(model_configs.tenant_id, tenantId),
    eq(model_configs.model_type, 'embedding'),
    eq(model_configs.enabled, true),
  ];

  if (excludeModelConfigId !== undefined) {
    conditions.push(ne(model_configs.id, excludeModelConfigId));
  }

  const where = and(...conditions);
  if (where === undefined) {
    throw new Error('Expected embedding where clause');
  }

  const [row] = await db.select({ total: count() }).from(model_configs).where(where);
  if (normalizeCount(row?.total) > 0) {
    throwApiError(
      ErrorCode.EMBEDDING_LIMIT_EXCEEDED,
      'Only one embedding model can be active',
      HttpStatus.CONFLICT,
    );
  }
}

function toAdminModelConfigResponse(row: ModelConfigRow): AdminModelConfigResponse {
  return {
    id: row.id,
    name: row.display_name,
    provider: row.provider,
    model_id: row.model_id,
    model_type: row.model_type,
    status: toModelStatus(row.enabled),
    config: {
      base_url: row.base_url,
      embedding_dim: row.embedding_dim,
      max_tokens: row.max_tokens,
      rate_limit_rpm: row.rate_limit_rpm,
    },
    visible_group_ids: normalizeVisibleGroupIds(row.visible_group_ids),
  };
}

function applyModelConfigFallback(existing: ModelConfigRow, updateValues: Partial<ModelConfigInsert>): ModelConfigRow {
  return {
    ...existing,
    provider: updateValues.provider ?? existing.provider,
    model_id: updateValues.model_id ?? existing.model_id,
    model_type: updateValues.model_type ?? existing.model_type,
    display_name: Object.hasOwn(updateValues, 'display_name')
      ? updateValues.display_name ?? null
      : existing.display_name,
    base_url: Object.hasOwn(updateValues, 'base_url') ? updateValues.base_url ?? null : existing.base_url,
    encrypted_api_key_ref: Object.hasOwn(updateValues, 'encrypted_api_key_ref')
      ? updateValues.encrypted_api_key_ref ?? null
      : existing.encrypted_api_key_ref,
    embedding_dim: updateValues.embedding_dim ?? existing.embedding_dim,
    max_tokens: updateValues.max_tokens ?? existing.max_tokens,
    rate_limit_rpm: updateValues.rate_limit_rpm ?? existing.rate_limit_rpm,
    enabled: updateValues.enabled ?? existing.enabled,
    visible_group_ids: updateValues.visible_group_ids ?? existing.visible_group_ids,
    updated_at: updateValues.updated_at ?? existing.updated_at,
  };
}

function buildModelOrder(sort: string): SQL {
  const parsed = parseSortSafely(sort);
  const columns = {
    created_at: model_configs.created_at,
    updated_at: model_configs.updated_at,
    provider: model_configs.provider,
    model_id: model_configs.model_id,
    model_type: model_configs.model_type,
    display_name: model_configs.display_name,
    name: model_configs.display_name,
    enabled: model_configs.enabled,
    status: model_configs.enabled,
  } as const;
  const column = columns[parsed.field as keyof typeof columns] as (typeof model_configs)[ModelSortField] | undefined;

  if (column === undefined) {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return parsed.direction === 'desc' ? desc(column) : asc(column);
}

function parseSortSafely(sort: string): ReturnType<typeof parseSortField> {
  try {
    return parseSortField(sort);
  } catch {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid sort field', HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

function validateSecretRefFormat(ref: string): void {
  if (!ref.startsWith('secret:') || ref.slice('secret:'.length).trim().length === 0) {
    throwApiError(
      ErrorCode.VALIDATION_ERROR,
      'encrypted_api_key_ref must use "secret:<name>" format',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

function parseSecretRef(encryptedApiKeyRef: string | null): string {
  const trimmed = encryptedApiKeyRef?.trim();
  if (trimmed === undefined || trimmed.length === 0 || !trimmed.startsWith('secret:')) {
    throwApiError(ErrorCode.SECRET_NOT_FOUND, 'Secret not found', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  const secretName = trimmed.slice('secret:'.length).trim();
  if (secretName.length === 0) {
    throwApiError(ErrorCode.SECRET_NOT_FOUND, 'Secret not found', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return secretName;
}

function normalizeModelTypeOrThrow(modelType: string): ModelType {
  const normalized = modelType.trim().toLowerCase();
  if (!VALID_MODEL_TYPES.has(normalized as ModelType)) {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid model type', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return normalized as ModelType;
}

function normalizeRequiredString(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throwApiError(ErrorCode.VALIDATION_ERROR, 'Invalid model config field', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  return value.trim().length > 0 ? value.trim() : null;
}

function normalizeVisibleGroupIds(value: unknown): string[] {
  return Array.isArray(value) ? normalizeIdList(value.filter((item): item is string => typeof item === 'string')) : [];
}

function normalizeIdList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizePage(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : DEFAULT_PAGE;
}

function normalizePerPage(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return DEFAULT_PER_PAGE;
  }

  return Math.min(value, MAX_PER_PAGE);
}

function normalizeCount(value: unknown): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function elapsedMs(startedAt: number): number {
  return Math.max(1, Date.now() - startedAt);
}

function remainingDeadlineMs(startedAt: number, deadlineMs: number): number {
  return Math.max(0, deadlineMs - (Date.now() - startedAt));
}

function toModelStatus(enabled: boolean): ModelStatus {
  return enabled ? 'active' : 'disabled';
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function throwModelNotFound(): never {
  throwApiError(ErrorCode.MODEL_NOT_FOUND, 'Model not found', HttpStatus.NOT_FOUND);
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!isRecord(err)) {
    return false;
  }

  return err.code === '23505' && (err.constraint === undefined || err.constraint === constraint);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function throwApiError(code: ErrorCode, message: string, status: HttpStatus): never {
  throw new HttpException({ code, message }, status);
}
