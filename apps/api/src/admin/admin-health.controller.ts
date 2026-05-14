import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { Permissions } from '@cherrygraph/auth-core';

import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import {
  sanitizeOutboundProbeError,
  validateAdminOutboundProbeUrl,
} from '../common/outbound-probe-safety.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { StorageService } from '../storage/storage.service.js';

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
type ComponentStatus = 'healthy' | 'unhealthy' | 'not_configured';
type ComponentName = 'database' | 'redis' | 'minio' | 'vector_store' | 'graph_store' | 'docmost_bridge';

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
  ) {}

  @Get('health')
  async getHealth(): Promise<AdminSystemHealthResponse> {
    const [database, redis, minio, docmost] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
      this.checkDocmost(),
    ]);
    const components: Record<ComponentName, HealthComponent> = {
      database,
      redis,
      minio,
      vector_store: postgresBackedComponent(database, 'Postgres-backed vector store'),
      graph_store: postgresBackedComponent(database, 'Postgres-backed graph store'),
      docmost_bridge: docmost,
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
    const targetValidation = await validateAdminOutboundProbeUrl(baseUrl);
    if (!targetValidation.ok) {
      return {
        status: 'unhealthy',
        latency_ms: elapsedMs(startedAt),
        error: targetValidation.error,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${targetValidation.url.toString().replace(/\/+$/, '')}/api/health`, {
        method: 'GET',
        signal: controller.signal,
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
          latency_ms: 5000,
          error: 'Health check timed out (5s)',
        };
      }

      return {
        status: 'unhealthy',
        latency_ms: elapsedMs(startedAt),
        error: sanitizeOutboundProbeError(err),
      };
    } finally {
      clearTimeout(timeout);
    }
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

function toSafeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
