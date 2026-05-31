import { sql } from 'drizzle-orm';

import { getDb } from './db.js';

export type JobPollOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

export async function waitForJob(
  jobId: string,
  opts?: JobPollOptions,
): Promise<{ status: string; result_json?: unknown; error_json?: unknown }> {
  const timeout = opts?.timeoutMs ?? 60_000;
  const interval = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeout;
  const db = getDb();

  while (Date.now() < deadline) {
    const rows = await db.execute(
      sql`SELECT status, result_json, error_json FROM jobs WHERE id = ${jobId}`,
    );
    const row = (rows.rows ?? rows)[0] as { status: string; result_json?: unknown; error_json?: unknown } | undefined;

    if (!row) throw new Error(`Job ${jobId} not found`);
    if (['completed', 'succeeded', 'failed'].includes(row.status)) return row;

    await sleep(interval);
  }

  throw new Error(`Job ${jobId} timed out after ${timeout}ms`);
}

export async function waitForJobByType(
  queue: string,
  type: string,
  opts?: JobPollOptions & { afterId?: string },
): Promise<{ id: string; status: string; result?: unknown }> {
  const timeout = opts?.timeoutMs ?? 60_000;
  const interval = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeout;
  const db = getDb();

  while (Date.now() < deadline) {
    const afterClause = opts?.afterId ? sql` AND id > ${opts.afterId}` : sql``;
    const rows = await db.execute(
      sql`SELECT id, status, result FROM jobs WHERE queue = ${queue} AND type = ${type}${afterClause} ORDER BY created_at DESC LIMIT 1`,
    );
    const row = (rows.rows ?? rows)[0] as { id: string; status: string; result?: unknown } | undefined;

    if (row && (row.status === 'completed' || row.status === 'failed')) return row;

    await sleep(interval);
  }

  throw new Error(`Job (queue=${queue}, type=${type}) timed out after ${timeout}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
