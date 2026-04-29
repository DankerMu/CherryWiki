import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MODEL_API_BASE_URL: z.string().min(1),
  MODEL_API_KEY: z.string().min(1),
  APP_URL: z.string().default('http://localhost'),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().default('development'),
  DEFAULT_CHAT_MODEL: z.string().default('gpt-4.1'),
  DEFAULT_EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),
  UPLOAD_MAX_SIZE_MB: z.coerce.number().int().positive().default(50),
  GRAPHIFY_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(3600),
  GRAPHIFY_MAX_NODES: z.coerce.number().int().positive().default(50000),
  GRAPHIFY_MAX_EDGES: z.coerce.number().int().positive().default(200000),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(9090),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, unknown> = process.env): Env {
  return envSchema.parse(input);
}
