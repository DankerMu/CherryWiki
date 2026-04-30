import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import { jobs, type JobInsert, type JobRow } from './schema.js';
import { JobStatus } from './status.js';

export type JobDatabase = NodePgDatabase;

export type JobCreateInput = {
  id?: string;
  tenant_id: string;
  space_id?: string | null;
  queue_name?: string;
  type: string;
  priority?: number;
  status?: JobStatus;
  attempt_count?: number;
  max_attempts?: number;
  timeout_seconds?: number | null;
  locked_by?: string | null;
  locked_at?: Date | null;
  next_run_at?: Date | null;
  cancel_requested_at?: Date | null;
  payload_json?: unknown;
  result_json?: unknown;
  error_json?: unknown;
  idempotency_key?: string | null;
  created_by?: string | null;
  created_at?: Date;
  started_at?: Date | null;
  completed_at?: Date | null;
};

export type JobUpdateInput = Partial<
  Pick<
    JobRow,
    | 'space_id'
    | 'queue_name'
    | 'type'
    | 'priority'
    | 'attempt_count'
    | 'max_attempts'
    | 'timeout_seconds'
    | 'locked_by'
    | 'locked_at'
    | 'next_run_at'
    | 'cancel_requested_at'
    | 'payload_json'
    | 'result_json'
    | 'error_json'
    | 'idempotency_key'
    | 'created_by'
    | 'created_at'
    | 'started_at'
    | 'completed_at'
  >
>;

export type JobFilter = {
  tenant_id?: string;
  space_id?: string;
  type?: string;
  status?: JobStatus;
  page?: number;
  perPage?: number;
  sort?: {
    field?: 'created_at' | 'priority' | 'next_run_at';
    direction?: 'asc' | 'desc';
  };
};

export type JobListResult = {
  items: JobRow[];
  total: number;
  page: number;
  perPage: number;
};

export class JobRepository {
  static async create(db: JobDatabase, data: JobCreateInput): Promise<JobRow> {
    const values = buildCreateValues(data);

    if (data.idempotency_key !== undefined && data.idempotency_key !== null) {
      const [created] = await db
        .insert(jobs)
        .values(values)
        .onConflictDoNothing({ target: [jobs.tenant_id, jobs.idempotency_key] })
        .returning();

      if (created !== undefined) {
        return created;
      }

      const [existing] = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.tenant_id, data.tenant_id), eq(jobs.idempotency_key, data.idempotency_key)))
        .limit(1);

      if (existing !== undefined) {
        return existing;
      }

      throw new Error(`Failed to resolve job conflict for tenant ${data.tenant_id}`);
    }

    const [created] = await db.insert(jobs).values(values).returning();
    if (created === undefined) {
      throw new Error('Failed to create job');
    }

    return created;
  }

  static async findById(db: JobDatabase, jobId: string): Promise<JobRow | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return job;
  }

  static async findByFilter(db: JobDatabase, filter: JobFilter = {}): Promise<JobListResult> {
    const page = normalizePositiveInt(filter.page, 1);
    const perPage = normalizePositiveInt(filter.perPage, 20);
    const where = buildWhereClause(filter);

    const orderClauses = buildOrderClauses(filter.sort);

    const itemsQuery = db.select().from(jobs).$dynamic();
    const items = await itemsQuery
      .where(where)
      .orderBy(...orderClauses)
      .limit(perPage)
      .offset((page - 1) * perPage);

    const countQuery = db.select({ total: count() }).from(jobs).$dynamic();
    const [countRow] = await countQuery.where(where);

    return {
      items,
      total: normalizeCount(countRow?.total),
      page,
      perPage,
    };
  }

  static async updateStatus(
    db: JobDatabase,
    jobId: string,
    newStatus: JobStatus,
    updates: JobUpdateInput = {},
  ): Promise<JobRow | undefined> {
    const [updated] = await db
      .update(jobs)
      .set({
        status: newStatus,
        ...updates,
      })
      .where(eq(jobs.id, jobId))
      .returning();

    return updated;
  }

  static async findPendingByType(
    db: JobDatabase,
    tenantId: string,
    type: string,
    limit: number,
  ): Promise<JobRow[]> {
    const normalizedLimit = Math.max(1, Math.trunc(limit));

    return db
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenant_id, tenantId), eq(jobs.type, type), eq(jobs.status, JobStatus.PENDING)))
      .orderBy(asc(jobs.priority), asc(jobs.created_at))
      .limit(normalizedLimit);
  }
}

function buildCreateValues(data: JobCreateInput): JobInsert {
  return {
    id: data.id ?? randomUUID(),
    tenant_id: data.tenant_id,
    type: data.type,
    ...(data.space_id !== undefined ? { space_id: data.space_id } : {}),
    ...(data.queue_name !== undefined ? { queue_name: data.queue_name } : {}),
    ...(data.priority !== undefined ? { priority: data.priority } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.attempt_count !== undefined ? { attempt_count: data.attempt_count } : {}),
    ...(data.max_attempts !== undefined ? { max_attempts: data.max_attempts } : {}),
    ...(data.timeout_seconds !== undefined ? { timeout_seconds: data.timeout_seconds } : {}),
    ...(data.locked_by !== undefined ? { locked_by: data.locked_by } : {}),
    ...(data.locked_at !== undefined ? { locked_at: data.locked_at } : {}),
    ...(data.next_run_at !== undefined ? { next_run_at: data.next_run_at } : {}),
    ...(data.cancel_requested_at !== undefined ? { cancel_requested_at: data.cancel_requested_at } : {}),
    ...(data.payload_json !== undefined ? { payload_json: data.payload_json } : {}),
    ...(data.result_json !== undefined ? { result_json: data.result_json } : {}),
    ...(data.error_json !== undefined ? { error_json: data.error_json } : {}),
    ...(data.idempotency_key !== undefined ? { idempotency_key: data.idempotency_key } : {}),
    ...(data.created_by !== undefined ? { created_by: data.created_by } : {}),
    ...(data.created_at !== undefined ? { created_at: data.created_at } : {}),
    ...(data.started_at !== undefined ? { started_at: data.started_at } : {}),
    ...(data.completed_at !== undefined ? { completed_at: data.completed_at } : {}),
  };
}

function buildWhereClause(filter: JobFilter): SQL | undefined {
  const conditions: SQL[] = [];

  if (filter.tenant_id !== undefined) {
    conditions.push(eq(jobs.tenant_id, filter.tenant_id));
  }
  if (filter.space_id !== undefined) {
    conditions.push(eq(jobs.space_id, filter.space_id));
  }
  if (filter.type !== undefined) {
    conditions.push(eq(jobs.type, filter.type));
  }
  if (filter.status !== undefined) {
    conditions.push(eq(jobs.status, filter.status));
  }

  if (conditions.length === 0) {
    return undefined;
  }

  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

function buildOrderClauses(sort?: JobFilter['sort']): SQL[] {
  const direction = sort?.direction === 'asc' ? 'asc' : 'desc';
  const field = sort?.field ?? 'created_at';
  const dirFn = direction === 'asc' ? asc : desc;

  if (field === 'priority') {
    return [dirFn(jobs.priority), dirFn(jobs.created_at)];
  }
  if (field === 'next_run_at') {
    return [dirFn(jobs.next_run_at), dirFn(jobs.created_at)];
  }
  return [dirFn(jobs.created_at), dirFn(jobs.id)];
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.trunc(value);
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}
