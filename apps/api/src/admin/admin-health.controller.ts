import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { Permissions } from '@cherrygraph/auth-core';

import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import {
  sanitizeOutboundProbeError,
  validateAdminOutboundProbeUrl,
} from '../common/outbound-probe-safety.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { ModelConfigService, type ModelProbeResponse } from '../models/model-config.service.js';
import { StorageService } from '../storage/storage.service.js';

const DOCMOST_HEALTH_TIMEOUT_MS = 5000;
const MODEL_PROBE_TIMEOUT_MS = 5000;
const MODELS_HEALTH_TIMEOUT_MS = 8000;

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
type ComponentStatus = 'healthy' | 'unhealthy' | 'not_configured';
type ComponentName =
  | 'database'
  | 'redis'
  | 'minio'
  | 'vector_store'
  | 'graph_store'
  | 'docmost_bridge'
  | 'models';

type DatabaseHealthClient = {
  $client: {
    query: (queryText: string) => Promise<unknown>;
  };
};

type RedisHealthClient = {
  ping: () => Promise<unknown>;
};

export type HealthComponent = {
  status: ComponentStatus;
  latency_ms?: number;
  error?: string;
  details?: string;
};

export type AdminSystemHealthResponse = {
  status: HealthStatus;
  components: Record<ComponentName, HealthComponent>;
  uptime: number;
};

@Permissions('admin:audit_view')
@Controller('admin/system')
export class AdminHealthController {
  constructor(
    @Inject(DRIZZLE) private readonly db: DatabaseHealthClient,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: RedisHealthClient,
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly modelConfigService?: ModelConfigService,
  ) {}

  @Get('health')
  async getHealth(): Promise<AdminSystemHealthResponse> {
    const [database, redis, minio, docmost, models] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
      this.checkDocmost(),
      this.checkModels(),
    ]);
    const components: Record<ComponentName, HealthComponent> = {
      database,
      redis,
      minio,
      vector_store: postgresBackedComponent(database, 'Postgres-backed vector store'),
      graph_store: postgresBackedComponent(database, 'Postgres-backed graph store'),
      docmost_bridge: docmost,
      models,
    };

    return {
      status: getOverallStatus(components),
      components,
      uptime: Math.max(1, Math.floor(process.uptime())),
    };
  }

  private async checkDatabase(): Promise<HealthComponent> {
    return measureComponent(async () => {
      await this.db.$client.query('select 1');
    });
  }

  private async checkRedis(): Promise<HealthComponent> {
    if (this.redis === undefined) {
      return { status: 'not_configured' };
    }

    return measureComponent(async () => {
      await this.redis?.ping();
    });
  }

  private async checkStorage(): Promise<HealthComponent> {
    if (this.storage === undefined || !this.storage.isConfigured()) {
      return { status: 'not_configured' };
    }

    return this.storage.healthCheck();
  }

  private async checkDocmost(): Promise<HealthComponent> {
    const baseUrl = process.env.DOCMOST_BASE_URL?.trim();
    if (baseUrl === undefined || baseUrl.length === 0) {
      return { status: 'not_configured', details: 'DOCMOST_BASE_URL not set' };
    }

    const startedAt = performance.now();
    const targetValidation = await validateAdminOutboundProbeUrl(baseUrl, {
      dnsTimeoutMs: remainingDeadlineMs(startedAt, DOCMOST_HEALTH_TIMEOUT_MS),
    });
    if (!targetValidation.ok) {
      return {
        status: 'unhealthy',
        latency_ms: elapsedMs(startedAt),
        error: targetValidation.error,
      };
    }

    const remainingMs = remainingDeadlineMs(startedAt, DOCMOST_HEALTH_TIMEOUT_MS);
    if (remainingMs <= 0) {
      await targetValidation.dispatcher.close().catch(() => undefined);
      return {
        status: 'unhealthy',
        latency_ms: elapsedMs(startedAt),
        error: 'Health check timed out (5s total)',
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const response = await fetch(`${targetValidation.url.toString().replace(/\/+$/, '')}/api/health`, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        dispatcher: targetValidation.dispatcher,
      });
      const result: HealthComponent =
        response.status === 200
          ? { status: 'healthy', latency_ms: elapsedMs(startedAt) }
          : { status: 'unhealthy', latency_ms: elapsedMs(startedAt), error: `HTTP ${response.status}` };
      await response.body?.cancel().catch(() => undefined);
      return result;
    } catch (err) {
      if (isAbortError(err)) {
        return {
          status: 'unhealthy',
          latency_ms: elapsedMs(startedAt),
          error: 'Health check timed out (5s total)',
        };
      }

      return {
        status: 'unhealthy',
        latency_ms: elapsedMs(startedAt),
        error: sanitizeOutboundProbeError(err),
      };
    } finally {
      clearTimeout(timeout);
      await targetValidation.dispatcher.close().catch(() => undefined);
    }
  }

  private async checkModels(): Promise<HealthComponent> {
    if (this.modelConfigService === undefined) {
      return { status: 'not_configured' };
    }

    try {
      const tenantId = await this.resolveTenantIdForHealth();
      const models = await this.modelConfigService.listEnabledModels(tenantId);
      if (models.length === 0) {
        return { status: 'not_configured' };
      }

      const timedOut = Symbol('models-health-timeout');
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<typeof timedOut>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timedOut), MODELS_HEALTH_TIMEOUT_MS);
        timeoutHandle.unref?.();
      });
      const probes = Promise.allSettled(
        models.map((model) => this.modelConfigService!.probeModel(model, MODEL_PROBE_TIMEOUT_MS)),
      );
      const settled = await Promise.race([probes, timeout]);
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      const results =
        settled === timedOut
          ? models.map((model) => ({
              model_id: model.model_id,
              model_type: model.model_type,
              reachable: false,
              latency_ms: MODELS_HEALTH_TIMEOUT_MS,
              error: 'Models health check timed out (8s total)',
            }))
          : settled.map((result, index) => toModelProbeDetail(result, models[index]!));

      return {
        status: results.every((result) => result.reachable) ? 'healthy' : 'unhealthy',
        details: JSON.stringify(results),
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        error: toSafeErrorMessage(err),
      };
    }
  }

  private async resolveTenantIdForHealth(): Promise<string> {
    const configuredTenantId = process.env.DEFAULT_TENANT_ID;
    if (configuredTenantId !== undefined && configuredTenantId.trim().length > 0) {
      return configuredTenantId.trim();
    }

    const tenantId = extractFirstTenantId(await this.db.$client.query('select id from tenants limit 1'));
    if (tenantId === null) {
      throw new Error('No tenant configured');
    }

    return tenantId;
  }
}

async function measureComponent(check: () => Promise<void>): Promise<HealthComponent> {
  const startedAt = performance.now();

  try {
    await check();
    return {
      status: 'healthy',
      latency_ms: elapsedMs(startedAt),
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      latency_ms: elapsedMs(startedAt),
      error: toSafeErrorMessage(err),
    };
  }
}

function getOverallStatus(components: Record<ComponentName, HealthComponent>): HealthStatus {
  if (components.database.status === 'unhealthy') {
    return 'unhealthy';
  }

  const hasOptionalUnhealthy = Object.entries(components).some(([name, component]) => {
    if (name === 'database' || component.status === 'not_configured') {
      return false;
    }

    return component.status === 'unhealthy';
  });

  return hasOptionalUnhealthy ? 'degraded' : 'healthy';
}

function postgresBackedComponent(database: HealthComponent, details: string): HealthComponent {
  if (database.status === 'healthy') {
    return {
      status: 'healthy',
      ...(database.latency_ms !== undefined ? { latency_ms: database.latency_ms } : {}),
      details,
    };
  }

  return {
    status: 'unhealthy',
    error: 'Depends on database health check',
    details,
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(1, Math.round(performance.now() - startedAt));
}

function remainingDeadlineMs(startedAt: number, deadlineMs: number): number {
  return Math.max(0, deadlineMs - Math.round(performance.now() - startedAt));
}

function toSafeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function toModelProbeDetail(
  result: PromiseSettledResult<ModelProbeResponse>,
  model: { model_id: string; model_type: string },
): ModelProbeResponse {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  return {
    model_id: model.model_id,
    model_type: model.model_type,
    reachable: false,
    latency_ms: 1,
    error: sanitizeOutboundProbeError(result.reason),
  };
}

function extractFirstTenantId(result: unknown): string | null {
  if (!isRecord(result) || !Array.isArray(result.rows)) {
    return null;
  }

  const rows = result.rows as unknown[];
  const row = rows[0];
  if (!isRecord(row) || typeof row.id !== 'string' || row.id.trim().length === 0) {
    return null;
  }

  return row.id.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
