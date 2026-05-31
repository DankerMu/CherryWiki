import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;
let db: NodePgDatabase | undefined;

export function getDb(): NodePgDatabase {
  if (db) return db;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for E2E tests');

  pool = new Pool({ connectionString: url, max: 5 });
  db = drizzle(pool);
  return db;
}

export function getRawPool(): pg.Pool {
  if (pool) return pool;
  getDb();
  return pool!;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
