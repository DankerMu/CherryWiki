import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Pool as PgPool, PoolConfig } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DRIZZLE } from '../drizzle.constants.js';
import { DrizzleModule, type DrizzleDatabase, type PgPoolFactory } from '../drizzle.module.js';

const TEST_DATABASE_URL = 'postgresql://cherrygraph:test@localhost:5432/cherrygraph_test';

let moduleRef: TestingModule | undefined;
const originalDatabaseUrl = process.env.DATABASE_URL;

describe('DrizzleModule', () => {
  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    restoreDatabaseUrl();
  });

  it('provides the DRIZZLE token from forRoot()', async () => {
    const { pool, end, configs, poolFactory } = createPoolStub();

    moduleRef = await Test.createTestingModule({
      imports: [DrizzleModule.forRoot({ databaseUrl: TEST_DATABASE_URL, connectionCheck: false, poolFactory })],
    }).compile();

    const db = moduleRef.get<DrizzleDatabase>(DRIZZLE);
    expect(db).toBeDefined();
    expect(db.$client).toBe(pool);
    expect(configs).toEqual([{ connectionString: TEST_DATABASE_URL, max: 20 }]);

    await moduleRef.close();
    moduleRef = undefined;
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('uses the configured pool max', async () => {
    const { configs, poolFactory } = createPoolStub();

    moduleRef = await Test.createTestingModule({
      imports: [DrizzleModule.forRoot({ databaseUrl: TEST_DATABASE_URL, poolMax: 5, connectionCheck: false, poolFactory })],
    }).compile();

    expect(configs).toEqual([{ connectionString: TEST_DATABASE_URL, max: 5 }]);
  });

  it('throws during module initialization when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const { poolFactory } = createPoolStub();

    await expect(
      Test.createTestingModule({
        imports: [DrizzleModule.forRoot({ connectionCheck: false, poolFactory })],
      }).compile(),
    ).rejects.toThrow('DATABASE_URL is required');
  });
});

function createPoolStub(): {
  pool: PgPool;
  end: ReturnType<typeof vi.fn<() => Promise<void>>>;
  configs: PoolConfig[];
  poolFactory: PgPoolFactory;
} {
  const end = vi.fn((): Promise<void> => Promise.resolve());
  const pool = { end } as unknown as PgPool;
  const configs: PoolConfig[] = [];
  const poolFactory: PgPoolFactory = (config) => {
    configs.push(config);
    return pool;
  };

  return { pool, end, configs, poolFactory };
}

function restoreDatabaseUrl(): void {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }

  process.env.DATABASE_URL = originalDatabaseUrl;
}
