import argon2 from 'argon2';
import pg from 'pg';

const { Pool } = pg;

const DEFAULT_TENANT_ID = 'default';
const DEFAULT_TENANT_NAME = 'Default Tenant';
const DEFAULT_ADMIN_EMAIL = 'admin@cherrywiki.local';
const DEFAULT_ADMIN_PASSWORD = 'Admin123!@#';
const DEFAULT_ADMIN_USER_ID = 'default-admin';

function resolveAdminPassword(): string {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword) {
    return adminPassword;
  }

  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    console.warn('ADMIN_PASSWORD is unset; using the development/test default admin password.');
    return DEFAULT_ADMIN_PASSWORD;
  }

  throw new Error('ADMIN_PASSWORD is required to run the seed script outside NODE_ENV=development or NODE_ENV=test');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run the seed script');
  }

  const adminEmail = process.env.ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL;
  const adminPassword = resolveAdminPassword();
  const adminPasswordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO tenants (id, name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO NOTHING
      `,
      [DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME],
    );
    await client.query(
      `
        INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `,
      [DEFAULT_ADMIN_USER_ID, DEFAULT_TENANT_ID, adminEmail, 'Admin', adminPasswordHash, 'admin', 'active'],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
