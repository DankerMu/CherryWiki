import argon2 from 'argon2';
import pg from 'pg';

const { Pool } = pg;

const DEFAULT_TENANT_ID = 'default';
const DEFAULT_TENANT_NAME = 'Default Tenant';
const DEFAULT_ADMIN_EMAIL = 'admin@cherrywiki.local';
const DEFAULT_ADMIN_PASSWORD = 'Admin123!@#';
const DEFAULT_ADMIN_USER_ID = 'default-admin';

const SEED_EMBEDDING_MODEL_ID = 'seed-embedding-default';
const DEFAULT_EMBEDDING_DIM = 1536; // text-embedding-3-small
// The API key never lives in model_configs; the ref names an env var the workers read at runtime.
const EMBEDDING_API_KEY_ENV = 'MODEL_API_KEY';

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

// Seeds an enabled embedding model_config from env so the indexer can boot on a fresh DB
// (it crashes with "No enabled embedding model configured" otherwise). Idempotent and
// non-destructive: only inserts when the env is fully present AND no enabled embedding model
// already exists, so an operator-created config is never overridden.
async function seedEmbeddingModel(client: pg.PoolClient): Promise<void> {
  const apiKey = process.env[EMBEDDING_API_KEY_ENV]?.trim();
  const modelId = process.env.DEFAULT_EMBEDDING_MODEL?.trim();
  if (!apiKey || !modelId) {
    console.warn(
      `Skipping embedding model seed: ${EMBEDDING_API_KEY_ENV} and DEFAULT_EMBEDDING_MODEL must both be set.`,
    );
    return;
  }

  const provider = process.env.MODEL_API_PROVIDER?.trim() || 'openai';
  const baseUrl = process.env.MODEL_API_BASE_URL?.trim() || null;
  const parsedDim = Number.parseInt(process.env.EMBEDDING_DIM ?? '', 10);
  const embeddingDim = Number.isInteger(parsedDim) && parsedDim > 0 ? parsedDim : DEFAULT_EMBEDDING_DIM;

  await client.query(
    `
      INSERT INTO model_configs
        (id, tenant_id, provider, model_id, model_type, display_name, base_url, encrypted_api_key_ref, embedding_dim, enabled)
      SELECT $1, $2, $3, $4, 'embedding', $5, $6, $7, $8, true
      WHERE NOT EXISTS (
        SELECT 1 FROM model_configs
        WHERE tenant_id = $2 AND model_type = 'embedding' AND enabled = true
      )
      ON CONFLICT (tenant_id, provider, model_id) DO NOTHING
    `,
    [
      SEED_EMBEDDING_MODEL_ID,
      DEFAULT_TENANT_ID,
      provider,
      modelId,
      `Seeded ${modelId}`,
      baseUrl,
      `secret:${EMBEDDING_API_KEY_ENV}`,
      embeddingDim,
    ],
  );
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
    await seedEmbeddingModel(client);
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
