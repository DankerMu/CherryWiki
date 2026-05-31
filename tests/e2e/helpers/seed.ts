import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDb, getRawPool } from './db.js';

// Must use 'default' tenant because API resolves tenant from DEFAULT_TENANT_ID env var
export const E2E_TENANT_ID = 'default';
export const E2E_SPACE_ID = `e2e-space-${randomUUID().slice(0, 8)}`;
export const E2E_SPACE_B_ID = `e2e-space-b-${randomUUID().slice(0, 8)}`;
export const E2E_USER_ID = `e2e-user-${randomUUID().slice(0, 8)}`;
export const E2E_GROUP_ID = `e2e-group-${randomUUID().slice(0, 8)}`;
export const E2E_ADMIN_EMAIL = `e2e-admin-${randomUUID().slice(0, 8)}@test.local`;
export const E2E_ADMIN_PASSWORD = 'E2eTest123!@#';
export const E2E_MODEL_CONFIG_ID = `e2e-model-${randomUUID().slice(0, 8)}`;
export const E2E_CHAT_MODEL_CONFIG_ID = `e2e-chat-model-${randomUUID().slice(0, 8)}`;

export async function seedTestData(): Promise<void> {
  const db = getDb();
  const passwordHash = await argon2.hash(E2E_ADMIN_PASSWORD, { type: argon2.argon2id });

  await db.execute(sql`
    INSERT INTO tenants (id, name) VALUES (${E2E_TENANT_ID}, ${'E2E Test Tenant'})
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, status)
    VALUES (${E2E_USER_ID}, ${E2E_TENANT_ID}, ${E2E_ADMIN_EMAIL}, ${'E2E Admin'}, ${passwordHash}, ${'admin'}, ${'active'})
    ON CONFLICT DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO groups (id, tenant_id, name) VALUES (${E2E_GROUP_ID}, ${E2E_TENANT_ID}, ${'E2E Group'})
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO group_members (tenant_id, group_id, user_id) VALUES (${E2E_TENANT_ID}, ${E2E_GROUP_ID}, ${E2E_USER_ID})
    ON CONFLICT DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO spaces (id, tenant_id, name, slug, wiki_repo_path)
    VALUES (${E2E_SPACE_ID}, ${E2E_TENANT_ID}, ${'E2E Space A'}, ${'e2e-space-a'}, ${`/tmp/e2e/${E2E_SPACE_ID}`})
    ON CONFLICT (id) DO NOTHING
  `);

  // Grant editor-level permissions to the E2E group on Space A
  const editorPermissions = [
    'space:read', 'space:view', 'space:edit',
    'chat:use', 'model:use',
    'upload:create', 'upload:read',
    'wiki:publish', 'wiki:rollback',
    'graphify:run', 'graphify:view',
  ];
  for (const perm of editorPermissions) {
    const permId = `e2e-perm-${E2E_SPACE_ID}-${perm.replace(':', '-')}`;
    await db.execute(sql`
      INSERT INTO space_permissions (id, tenant_id, space_id, group_id, permission)
      VALUES (${permId}, ${E2E_TENANT_ID}, ${E2E_SPACE_ID}, ${E2E_GROUP_ID}, ${perm})
      ON CONFLICT DO NOTHING
    `);
  }

  // Mock embedding model config for E2E fixture data (used by index build test)
  await db.execute(sql`
    INSERT INTO model_configs (id, tenant_id, provider, model_id, model_type, display_name, embedding_dim, enabled)
    VALUES (${E2E_MODEL_CONFIG_ID}, ${E2E_TENANT_ID}, ${'mock'}, ${'mock-e2e-embedding'}, ${'embedding'}, ${'E2E Mock Embedding'}, ${3072}, ${true})
    ON CONFLICT ON CONSTRAINT model_configs_tenant_id_provider_model_id_unique DO UPDATE SET enabled = true
  `);

  // Chat model config — encrypted_api_key_ref uses secret:ENV_VAR_NAME format
  const chatModelId = process.env.DEFAULT_CHAT_MODEL ?? 'deepseek-v4-flash';
  const modelBaseUrl = process.env.MODEL_API_BASE_URL ?? 'https://www.dmxapi.cn/v1';
  await db.execute(sql`
    INSERT INTO model_configs (id, tenant_id, provider, model_id, model_type, display_name, enabled, base_url, encrypted_api_key_ref)
    VALUES (${E2E_CHAT_MODEL_CONFIG_ID}, ${E2E_TENANT_ID}, ${'openai'}, ${chatModelId}, ${'chat'}, ${'E2E Chat Model'}, ${true}, ${modelBaseUrl}, ${'secret:model_api_key'})
    ON CONFLICT ON CONSTRAINT model_configs_tenant_id_provider_model_id_unique
    DO UPDATE SET enabled = true, base_url = ${modelBaseUrl}, encrypted_api_key_ref = 'secret:model_api_key'
  `);

  // Embedding model config for real retrieval
  const embModelId = process.env.DEFAULT_EMBEDDING_MODEL ?? 'text-embedding-3-small';
  await db.execute(sql`
    INSERT INTO model_configs (id, tenant_id, provider, model_id, model_type, display_name, enabled, base_url, encrypted_api_key_ref, embedding_dim)
    VALUES (${`e2e-embed-real-${randomUUID().slice(0, 8)}`}, ${E2E_TENANT_ID}, ${'openai'}, ${embModelId}, ${'embedding'}, ${'E2E Embedding Model'}, ${true}, ${modelBaseUrl}, ${'secret:model_api_key'}, ${1536})
    ON CONFLICT ON CONSTRAINT model_configs_tenant_id_provider_model_id_unique
    DO UPDATE SET enabled = true, base_url = ${modelBaseUrl}, encrypted_api_key_ref = 'secret:model_api_key'
  `);

  // Space B: user has no access (for permission isolation test)
  await db.execute(sql`
    INSERT INTO spaces (id, tenant_id, name, slug, wiki_repo_path)
    VALUES (${E2E_SPACE_B_ID}, ${E2E_TENANT_ID}, ${'E2E Space B (No Access)'}, ${'e2e-space-b'}, ${`/tmp/e2e/${E2E_SPACE_B_ID}`})
    ON CONFLICT (id) DO NOTHING
  `);
}

export async function cleanupTestData(): Promise<void> {
  const pool = getRawPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Disable FK checks for reliable cleanup of deeply-linked E2E data
    await client.query(`SET session_replication_role = 'replica'`);

    await client.query(`DELETE FROM answer_citations WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM retrieval_traces WHERE conversation_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)`, [E2E_USER_ID]);
    await client.query(`DELETE FROM model_usage_logs WHERE conversation_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)`, [E2E_USER_ID]);
    await client.query(`DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)`, [E2E_USER_ID]);
    await client.query(`DELETE FROM chat_session_spaces WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)`, [E2E_USER_ID]);
    await client.query(`DELETE FROM chat_sessions WHERE user_id = $1`, [E2E_USER_ID]);
    await client.query(`DELETE FROM embeddings WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM wiki_chunks WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM wiki_sections WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM wiki_page_versions WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM index_snapshots WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM wiki_pages WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM graph_edges WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM graph_nodes WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM graphify_runs WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM source_documents WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE space_id IN ($1, $2))`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM jobs WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM model_configs WHERE id IN ($1, $2)`, [E2E_MODEL_CONFIG_ID, E2E_CHAT_MODEL_CONFIG_ID]);
    await client.query(`DELETE FROM space_permissions WHERE space_id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM spaces WHERE id IN ($1, $2)`, [E2E_SPACE_ID, E2E_SPACE_B_ID]);
    await client.query(`DELETE FROM audit_logs WHERE actor_user_id = $1`, [E2E_USER_ID]);
    await client.query(`DELETE FROM group_members WHERE group_id = $1`, [E2E_GROUP_ID]);
    await client.query(`DELETE FROM groups WHERE id = $1`, [E2E_GROUP_ID]);
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [E2E_USER_ID]);
    await client.query(`DELETE FROM users WHERE id = $1`, [E2E_USER_ID]);

    await client.query(`SET session_replication_role = 'origin'`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
