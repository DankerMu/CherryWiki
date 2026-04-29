import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import request from 'supertest';

import { AppModule } from '../../app.module.js';
import { configureApp } from '../../main.js';

let app: NestFastifyApplication | undefined;
const TEST_DATABASE_URL = 'postgresql://cherrygraph:test@localhost:5432/cherrygraph_test';
const originalDatabaseUrl = process.env.DATABASE_URL;

describe('HealthController', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    restoreDatabaseUrl();
  });

  it('returns healthy status, version, and uptime from GET /api/health', async () => {
    app = await createTestApp();
    const fastify = app.getHttpAdapter().getInstance();

    const response = await request(fastify.server).get('/api/health').expect(200);
    const body = parseJsonObject(response.text);

    expect(body.status).toBe('healthy');
    expect(body.version).toBe(readPackageVersion());
    expect(Number.isInteger(body.uptime)).toBe(true);
    expect(typeof body.uptime === 'number' && body.uptime > 0).toBe(true);
  });
});

async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const testApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
  configureApp(testApp);
  await testApp.init();
  await testApp.getHttpAdapter().getInstance().ready();
  return testApp;
}

function readPackageVersion(): string {
  const packageJson = parseJsonObject(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  if (typeof packageJson.version !== 'string') {
    throw new Error('Expected package.json version to be a string');
  }

  return packageJson.version;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object');
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function restoreDatabaseUrl(): void {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }

  process.env.DATABASE_URL = originalDatabaseUrl;
}
