import { DynamicModule, Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Pool as PgPool, PoolConfig } from 'pg';

import { DRIZZLE } from './drizzle.constants.js';

const PG_POOL = Symbol('PG_POOL');
const DEFAULT_POOL_MAX = 20;

export type DrizzleDatabase = NodePgDatabase & { $client: PgPool };
export type PgPoolFactory = (config: PoolConfig) => PgPool;

export interface DrizzleModuleOptions {
  databaseUrl?: string;
  poolMax?: number;
  connectionCheck?: boolean;
  poolFactory?: PgPoolFactory;
}

@Injectable()
class PgPoolShutdown implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: PgPool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({})
export class DrizzleModule {
  static forRoot(options: DrizzleModuleOptions = {}): DynamicModule {
    return {
      module: DrizzleModule,
      providers: [
        {
          provide: PG_POOL,
          useFactory: (): Promise<PgPool> => createPool(options),
        },
        {
          provide: DRIZZLE,
          useFactory: (pool: PgPool): DrizzleDatabase => drizzle(pool),
          inject: [PG_POOL],
        },
        PgPoolShutdown,
      ],
      exports: [DRIZZLE],
    };
  }
}

async function createPool(options: DrizzleModuleOptions): Promise<PgPool> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required to initialize DrizzleModule');
  }

  const poolConfig: PoolConfig = {
    connectionString: databaseUrl,
    max: options.poolMax ?? DEFAULT_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };

  const createPgPool = options.poolFactory ?? ((config: PoolConfig): PgPool => new pg.Pool(config));
  const pool = createPgPool(poolConfig);

  if (options.connectionCheck ?? true) {
    try {
      await pool.query('select 1');
    } catch (err) {
      await pool.end();
      throw err;
    }
  }

  return pool;
}
