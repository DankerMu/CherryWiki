import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { envSchema, type Env } from '../env.js';

const createValidEnv = (): Record<string, string> => ({
  DATABASE_URL: 'postgresql://cherrygraph:password@localhost:5432/cherrygraph',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long!!',
  MINIO_ENDPOINT: 'http://localhost:9000',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'strong-password-here',
  MODEL_API_BASE_URL: 'https://api.openai.com/v1',
  MODEL_API_KEY: 'sk-replace-with-model-api-key',
});

describe('envSchema', () => {
  it('parses a complete valid environment object', () => {
    const parsed: Env = envSchema.parse({
      ...createValidEnv(),
      APP_URL: 'https://studio.example.com',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
      DEFAULT_CHAT_MODEL: 'gpt-4.1',
      DEFAULT_EMBEDDING_MODEL: 'text-embedding-3-large',
      UPLOAD_MAX_SIZE_MB: '25',
      GRAPHIFY_TIMEOUT_SECONDS: '120',
      GRAPHIFY_MAX_NODES: '1000',
      GRAPHIFY_MAX_EDGES: '2000',
      WORKER_HEALTH_PORT: '9091',
    });

    expect(parsed.DATABASE_URL).toBe('postgresql://cherrygraph:password@localhost:5432/cherrygraph');
    expect(parsed.UPLOAD_MAX_SIZE_MB).toBe(25);
    expect(parsed.WORKER_HEALTH_PORT).toBe(9091);
  });

  it('throws a ZodError that includes DATABASE_URL when the field is missing', () => {
    const input = createValidEnv();
    delete input.DATABASE_URL;

    expect(() => envSchema.parse(input)).toThrow(ZodError);

    try {
      envSchema.parse(input);
    } catch (error: unknown) {
      if (!(error instanceof ZodError)) {
        throw error;
      }

      expect(String(error)).toContain('DATABASE_URL');
    }
  });

  it('uses the default LOG_LEVEL when it is omitted', () => {
    const parsed = envSchema.parse(createValidEnv());

    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('coerces UPLOAD_MAX_SIZE_MB to a number', () => {
    const parsed = envSchema.parse({
      ...createValidEnv(),
      UPLOAD_MAX_SIZE_MB: '64',
    });

    expect(parsed.UPLOAD_MAX_SIZE_MB).toBe(64);
  });

  it('rejects JWT_SECRET shorter than 32 characters', () => {
    const input = { ...createValidEnv(), JWT_SECRET: 'short' };

    expect(() => envSchema.parse(input)).toThrow(ZodError);
  });

  it('rejects WORKER_HEALTH_PORT above 65535', () => {
    const input = { ...createValidEnv(), WORKER_HEALTH_PORT: '70000' };

    expect(() => envSchema.parse(input)).toThrow(ZodError);
  });

  it('provides defaults for Phase 1 Graphify fields', () => {
    const parsed = envSchema.parse(createValidEnv());

    expect(parsed.GRAPHIFY_WORKDIR).toBe('/work/graphify');
    expect(parsed.GRAPHIFY_DEFAULT_MODE).toBe('deep');
    expect(parsed.GRAPHIFY_ENABLE_WIKI).toBe(true);
    expect(parsed.GRAPHIFY_TIMEOUT_SECONDS).toBe(3600);
  });

  it('provides defaults for SSRF protection fields', () => {
    const parsed = envSchema.parse(createValidEnv());

    expect(parsed.SSRF_BLOCKED_CIDRS).toContain('127.0.0.0/8');
    expect(parsed.URL_FETCH_TIMEOUT_SECONDS).toBe(30);
  });
});
