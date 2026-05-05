import { z } from 'zod';

export const envSchema = z.object({
  // Required — app core
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MODEL_API_BASE_URL: z.string().min(1),
  MODEL_API_KEY: z.string().min(1),

  // Optional — app config
  APP_URL: z.string().default('http://localhost'),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().default('development'),
  DEFAULT_CHAT_MODEL: z.string().default('gpt-4.1'),
  DEFAULT_EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),

  // Upload limits
  UPLOAD_MAX_SIZE_MB: z.coerce.number().int().positive().max(500).default(50),
  UPLOAD_HARD_LIMIT_MB: z.coerce.number().int().positive().max(1000).default(200),

  // Graphify
  GRAPHIFY_WORKDIR: z.string().default('/work/graphify'),
  GRAPHIFY_DEFAULT_MODE: z.string().default('deep'),
  GRAPHIFY_ENABLE_WIKI: z.coerce.boolean().default(true),
  GRAPHIFY_PINNED_REF: z.string().optional(),
  GRAPHIFY_TIMEOUT_SECONDS: z.coerce.number().int().positive().max(86400).default(3600),
  GRAPHIFY_MAX_NODES: z.coerce.number().int().positive().max(500000).default(50000),
  GRAPHIFY_MAX_EDGES: z.coerce.number().int().positive().max(2000000).default(200000),

  // Worker
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9090),

  // SSRF protection (Phase 1 url-fetcher-worker)
  SSRF_BLOCKED_CIDRS: z.string().default('127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,::1/128,fc00::/7'),
  URL_FETCH_TIMEOUT_SECONDS: z.coerce.number().int().positive().max(300).default(30),
  URL_FETCH_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(52428800),
  EGRESS_PROXY_URL: z.string().optional(),

  // Docmost (Phase 2 — optional in Phase 1)
  DOCMOST_BASE_URL: z.string().optional(),
  DOCMOST_BRIDGE_SECRET: z.string().optional(),
  DOCMOST_BRIDGE_SECRET_NEXT: z.string().optional(),

  // Postgres password (used by docker-compose, not app code directly)
  POSTGRES_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Environment validation failed [${missing}]: ${result.error.message}`);
  }
  return result.data;
}
