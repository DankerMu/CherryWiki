import { randomUUID } from 'node:crypto';

import {
  JobStatus,
  job_events,
  jobs,
  type JobDatabase,
  type JobEventRow,
  type JobRow,
  type RedisJobLockClient,
} from '@cherrygraph/job-core';

export const TEST_TENANT_ID = 'tenant-1';
export const TEST_SPACE_ID = 'space-1';
export const TEST_USER_ID = 'user-1';

type SupportedTable = typeof jobs | typeof job_events;
type SortDirection = 'asc' | 'desc';
type PredicateNode =
  | { type: 'and'; nodes: PredicateNode[] }
  | { type: 'eq'; column: string; value: unknown }
  | { type: 'in'; column: string; values: unknown[] }
  | { type: 'is-null'; column: string }
  | { type: 'is-not-null'; column: string }
  | { type: 'next-run-ready'; column: string }
  | { type: 'timeout-expired'; lockedAtColumn: string; timeoutColumn: string; defaultSeconds: number };
type SortNode = {
  column: string;
  direction: SortDirection;
};
type RedisEntry = {
  value: string;
  expiresAt: number | null;
};

export class InMemoryJobDb {
  private readonly jobRows: JobRow[];
  private readonly eventRows: JobEventRow[];

  constructor(seed: { jobs?: JobRow[]; events?: JobEventRow[] } = {}) {
    this.jobRows = clone(seed.jobs ?? []);
    this.eventRows = clone(seed.events ?? []);
  }

  asDb(): JobDatabase {
    return this as unknown as JobDatabase;
  }

  async transaction<T>(callback: (tx: JobDatabase) => Promise<T>): Promise<T> {
    return callback(this.asDb());
  }

  select(fields?: unknown): InMemorySelectBuilder {
    return new InMemorySelectBuilder(this, fields);
  }

  insert(table?: unknown): { values: (value: unknown) => InMemoryInsertBuilder } {
    return {
      values: (value: unknown) => new InMemoryInsertBuilder(this, table, value),
    };
  }

  update(table?: unknown): { set: (value: unknown) => InMemoryUpdateBuilder } {
    return {
      set: (value: unknown) => new InMemoryUpdateBuilder(this, table, value),
    };
  }

  getJob(jobId: string): JobRow | undefined {
    return clone(this.jobRows.find((row) => row.id === jobId));
  }

  getJobs(): JobRow[] {
    return clone(this.jobRows);
  }

  getEvents(): JobEventRow[] {
    return clone(this.eventRows);
  }

  selectRows(
    table: unknown,
    fields: unknown,
    condition: unknown,
    orderByClauses: unknown[],
    limitValue: number | undefined,
    offsetValue: number | undefined,
  ): unknown[] {
    const rows = this.getTable(table);
    const filtered = rows.filter((row) => matchesCondition(row, condition));
    const ordered = applyOrderBy(filtered, orderByClauses);
    const offset = offsetValue ?? 0;
    const limited = limitValue === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + limitValue);
    return projectRows(limited, fields);
  }

  insertRows(table: unknown, value: unknown, conflictTarget: unknown): unknown[] {
    const values = Array.isArray(value) ? value : [value];
    const inserted: unknown[] = [];

    for (const entry of values) {
      if (!isRecord(entry)) {
        continue;
      }

      if (table === jobs) {
        const row = normalizeJobRow(entry as Partial<JobRow>);
        if (hasIdempotencyConflict(this.jobRows, row, conflictTarget)) {
          continue;
        }

        this.jobRows.push(row);
        inserted.push(clone(row));
        continue;
      }

      if (table === job_events) {
        const row = normalizeEventRow(entry as Partial<JobEventRow>);
        this.eventRows.push(row);
        inserted.push(clone(row));
        continue;
      }

      throw new Error('Unsupported table insert in Stage 2 integration harness');
    }

    return inserted;
  }

  updateRows(table: unknown, value: unknown, condition: unknown): unknown[] {
    if (!isRecord(value)) {
      throw new Error('Stage 2 integration harness updates require record values');
    }

    const rows = this.getTable(table);
    const updated: unknown[] = [];

    for (const row of rows) {
      if (!matchesCondition(row, condition)) {
        continue;
      }

      Object.assign(row, clone(value));
      updated.push(clone(row));
    }

    return updated;
  }

  private getTable(table: unknown): Array<JobRow | JobEventRow> {
    if (table === jobs) {
      return this.jobRows;
    }

    if (table === job_events) {
      return this.eventRows;
    }

    throw new Error('Unsupported table access in Stage 2 integration harness');
  }
}

class InMemorySelectBuilder implements PromiseLike<unknown[]> {
  private table?: unknown;
  private condition?: unknown;
  private readonly orderByClauses: unknown[] = [];
  private limitValue?: number;
  private offsetValue?: number;

  constructor(
    private readonly db: InMemoryJobDb,
    private readonly fields?: unknown,
  ) {}

  from(table?: unknown): this {
    this.table = table;
    return this;
  }

  $dynamic(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }

  orderBy(...clauses: unknown[]): this {
    this.orderByClauses.push(...clauses);
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(
      this.db.selectRows(
        this.table,
        this.fields,
        this.condition,
        this.orderByClauses,
        this.limitValue,
        this.offsetValue,
      ),
    ).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

class InMemoryInsertBuilder {
  private conflictTarget?: unknown;

  constructor(
    private readonly db: InMemoryJobDb,
    private readonly table: unknown,
    private readonly value: unknown,
  ) {}

  onConflictDoNothing(config: { target: unknown }): this {
    this.conflictTarget = config.target;
    return this;
  }

  async returning(): Promise<unknown[]> {
    return this.db.insertRows(this.table, this.value, this.conflictTarget);
  }
}

class InMemoryUpdateBuilder {
  private condition?: unknown;

  constructor(
    private readonly db: InMemoryJobDb,
    private readonly table: unknown,
    private readonly value: unknown,
  ) {}

  where(condition: unknown): this {
    this.condition = condition;
    return this;
  }

  async returning(): Promise<unknown[]> {
    return this.db.updateRows(this.table, this.value, this.condition);
  }
}

export class ExpiringRedisMock implements RedisJobLockClient {
  private readonly store = new Map<string, RedisEntry>();

  async get(key: string): Promise<string | null> {
    this.purgeExpired(key);
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<string | null> {
    this.purgeExpired(key);

    const ttlSeconds = parseTtlSeconds(args);
    const mode = parseMode(args);

    if (mode === 'NX' && this.store.has(key)) {
      return null;
    }

    if (mode === 'XX' && !this.store.has(key)) {
      return null;
    }

    this.store.set(key, {
      value,
      expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1_000,
    });

    return 'OK';
  }

  async eval(script: string, _numKeys: number, ...args: Array<string | number>): Promise<number | string | null> {
    const [key, workerId, ttlSeconds] = args;
    if (typeof key !== 'string' || typeof workerId !== 'string') {
      throw new Error('ExpiringRedisMock requires string key and worker id');
    }

    this.purgeExpired(key);

    if (
      script ===
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
    ) {
      if (this.store.get(key)?.value === workerId) {
        this.store.delete(key);
        return 1;
      }

      return 0;
    }

    if (
      script ===
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]) else return nil end"
    ) {
      if (typeof ttlSeconds !== 'number') {
        throw new Error('ExpiringRedisMock renew requires a numeric TTL');
      }

      if (this.store.get(key)?.value !== workerId) {
        return null;
      }

      this.store.set(key, {
        value: workerId,
        expiresAt: Date.now() + ttlSeconds * 1_000,
      });
      return 'OK';
    }

    throw new Error(`Unsupported Redis Lua script: ${script}`);
  }

  seed(key: string, value: string, ttlSeconds = 600): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
  }

  has(key: string): boolean {
    this.purgeExpired(key);
    return this.store.has(key);
  }

  private purgeExpired(key: string): void {
    const entry = this.store.get(key);
    if (entry?.expiresAt !== null && entry !== undefined && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
    }
  }
}

export function createJobRecord(overrides: Partial<JobRow> = {}): JobRow {
  return normalizeJobRow(overrides);
}

export function createJobEventRecord(overrides: Partial<JobEventRow> = {}): JobEventRow {
  return normalizeEventRow(overrides);
}

function normalizeJobRow(overrides: Partial<JobRow>): JobRow {
  return {
    id: overrides.id ?? randomUUID(),
    tenant_id: overrides.tenant_id ?? TEST_TENANT_ID,
    space_id: overrides.space_id === undefined ? TEST_SPACE_ID : overrides.space_id,
    queue_name: overrides.queue_name ?? 'default',
    type: overrides.type ?? 'graphify',
    priority: overrides.priority ?? 100,
    status: overrides.status ?? JobStatus.PENDING,
    attempt_count: overrides.attempt_count ?? 0,
    max_attempts: overrides.max_attempts ?? 3,
    timeout_seconds: overrides.timeout_seconds === undefined ? 600 : overrides.timeout_seconds,
    locked_by: overrides.locked_by === undefined ? null : overrides.locked_by,
    locked_at: overrides.locked_at === undefined ? null : overrides.locked_at,
    next_run_at: overrides.next_run_at === undefined ? null : overrides.next_run_at,
    cancel_requested_at: overrides.cancel_requested_at === undefined ? null : overrides.cancel_requested_at,
    payload_json: overrides.payload_json ?? {},
    result_json: overrides.result_json === undefined ? null : overrides.result_json,
    error_json: overrides.error_json === undefined ? null : overrides.error_json,
    idempotency_key: overrides.idempotency_key === undefined ? null : overrides.idempotency_key,
    created_by: overrides.created_by === undefined ? TEST_USER_ID : overrides.created_by,
    created_at: overrides.created_at ?? new Date(),
    started_at: overrides.started_at === undefined ? null : overrides.started_at,
    completed_at: overrides.completed_at === undefined ? null : overrides.completed_at,
  };
}

function normalizeEventRow(overrides: Partial<JobEventRow>): JobEventRow {
  return {
    id: overrides.id ?? randomUUID(),
    job_id: overrides.job_id ?? 'job-1',
    event_type: overrides.event_type ?? 'status_changed',
    detail_json: overrides.detail_json ?? {},
    created_at: overrides.created_at ?? new Date(),
  };
}

function hasIdempotencyConflict(existingRows: JobRow[], nextRow: JobRow, conflictTarget: unknown): boolean {
  if (!Array.isArray(conflictTarget)) {
    return false;
  }

  const targetColumns = conflictTarget
    .map((entry) => (isRecord(entry) && typeof entry.name === 'string' ? entry.name : undefined))
    .filter((value): value is string => value !== undefined);

  if (!targetColumns.includes('tenant_id') || !targetColumns.includes('idempotency_key')) {
    return false;
  }

  if (nextRow.idempotency_key === null) {
    return false;
  }

  return existingRows.some(
    (row) => row.tenant_id === nextRow.tenant_id && row.idempotency_key === nextRow.idempotency_key,
  );
}

function projectRows(rows: Array<JobRow | JobEventRow>, fields: unknown): unknown[] {
  if (fields === undefined) {
    return clone(rows);
  }

  if (isRecord(fields) && Object.keys(fields).length === 1 && 'total' in fields) {
    return [{ total: rows.length }];
  }

  if (!isRecord(fields)) {
    return clone(rows);
  }

  return rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const [alias, field] of Object.entries(fields)) {
      const columnName = resolveColumnName(field);
      projected[alias] = columnName === undefined ? undefined : (row as Record<string, unknown>)[columnName];
    }

    return projected;
  });
}

function applyOrderBy(rows: Array<JobRow | JobEventRow>, clauses: unknown[]): Array<JobRow | JobEventRow> {
  if (clauses.length === 0) {
    return rows.slice();
  }

  const sortNodes = clauses.map(parseSortClause);
  return rows.slice().sort((left, right) => {
    for (const sortNode of sortNodes) {
      const comparison = compareValues(
        (left as Record<string, unknown>)[sortNode.column],
        (right as Record<string, unknown>)[sortNode.column],
      );

      if (comparison !== 0) {
        return sortNode.direction === 'asc' ? comparison : -comparison;
      }
    }

    return 0;
  });
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return 1;
  }

  if (right === null || right === undefined) {
    return -1;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

function parseSortClause(clause: unknown): SortNode {
  const chunks = getQueryChunks(clause);
  if (
    chunks.length === 3 &&
    chunkText(chunks[0]) === '' &&
    resolveColumnName(chunks[1]) !== undefined &&
    (chunkText(chunks[2]) === ' asc' || chunkText(chunks[2]) === ' desc')
  ) {
    return {
      column: resolveColumnName(chunks[1]) ?? '',
      direction: chunkText(chunks[2]).trim() as SortDirection,
    };
  }

  throw new Error('Unsupported sort clause in Stage 2 integration harness');
}

function matchesCondition(row: JobRow | JobEventRow, condition: unknown): boolean {
  if (condition === undefined) {
    return true;
  }

  return evaluatePredicate(parsePredicate(condition), row as Record<string, unknown>);
}

function parsePredicate(condition: unknown): PredicateNode {
  const chunks = getQueryChunks(condition);

  if (
    chunks.length === 3 &&
    chunkText(chunks[0]) === '(' &&
    hasQueryChunks(chunks[1]) &&
    chunkText(chunks[2]) === ')'
  ) {
    const nodes = splitAndClauses(getQueryChunks(chunks[1])).map(parsePredicate);
    return {
      type: 'and',
      nodes,
    };
  }

  if (
    chunks.length === 5 &&
    chunkText(chunks[0]) === '' &&
    resolveColumnName(chunks[1]) !== undefined &&
    chunkText(chunks[2]) === ' = ' &&
    isParam(chunks[3]) &&
    chunkText(chunks[4]) === ''
  ) {
    return {
      type: 'eq',
      column: resolveColumnName(chunks[1]) ?? '',
      value: chunks[3].value,
    };
  }

  if (
    chunks.length === 5 &&
    chunkText(chunks[0]) === '' &&
    resolveColumnName(chunks[1]) !== undefined &&
    chunkText(chunks[2]) === ' in ' &&
    Array.isArray(chunks[3]) &&
    chunkText(chunks[4]) === ''
  ) {
    return {
      type: 'in',
      column: resolveColumnName(chunks[1]) ?? '',
      values: chunks[3].filter(isParam).map((entry) => entry.value),
    };
  }

  if (
    chunks.length === 3 &&
    chunkText(chunks[0]) === '' &&
    resolveColumnName(chunks[1]) !== undefined &&
    chunkText(chunks[2]) === ' is null'
  ) {
    return {
      type: 'is-null',
      column: resolveColumnName(chunks[1]) ?? '',
    };
  }

  if (
    chunks.length === 3 &&
    chunkText(chunks[0]) === '' &&
    resolveColumnName(chunks[1]) !== undefined &&
    chunkText(chunks[2]) === ' is not null'
  ) {
    return {
      type: 'is-not-null',
      column: resolveColumnName(chunks[1]) ?? '',
    };
  }

  if (
    chunks.length === 5 &&
    chunkText(chunks[0]) === '(' &&
    resolveColumnName(chunks[1]) !== undefined &&
    chunkText(chunks[2]) === ' IS NULL OR ' &&
    resolveColumnName(chunks[3]) === resolveColumnName(chunks[1]) &&
    chunkText(chunks[4]) === ' <= now())'
  ) {
    return {
      type: 'next-run-ready',
      column: resolveColumnName(chunks[1]) ?? '',
    };
  }

  if (
    (chunks.length === 5 || chunks.length === 7) &&
    chunkText(chunks[0]) === '' &&
    resolveColumnName(chunks[1]) !== undefined &&
    chunkText(chunks[2]) === ' + coalesce(' &&
    resolveColumnName(chunks[3]) !== undefined
  ) {
    const defaultSeconds =
      chunks.length === 7
        ? normalizeNumericChunk(chunks[5]) ?? 1800
        : Number.parseInt(chunkText(chunks[4]).match(/^,\s*(\d+)\)/)?.[1] ?? '1800', 10);
    const tail = chunks.length === 7 ? chunkText(chunks[6]) : chunkText(chunks[4]);

    if (tail === ") * interval '1 second' < now()" || tail.endsWith("* interval '1 second' < now()")) {
      return {
        type: 'timeout-expired',
        lockedAtColumn: resolveColumnName(chunks[1]) ?? '',
        timeoutColumn: resolveColumnName(chunks[3]) ?? '',
        defaultSeconds,
      };
    }
  }

  throw new Error('Unsupported SQL predicate in Stage 2 integration harness');
}

function evaluatePredicate(node: PredicateNode, row: Record<string, unknown>): boolean {
  if (node.type === 'and') {
    return node.nodes.every((child) => evaluatePredicate(child, row));
  }

  if (node.type === 'eq') {
    return row[node.column] === node.value;
  }

  if (node.type === 'in') {
    return node.values.includes(row[node.column]);
  }

  if (node.type === 'is-null') {
    return row[node.column] === null || row[node.column] === undefined;
  }

  if (node.type === 'is-not-null') {
    return row[node.column] !== null && row[node.column] !== undefined;
  }

  if (node.type === 'next-run-ready') {
    const value = row[node.column];
    return !(value instanceof Date) || value.getTime() <= Date.now();
  }

  const lockedAt = row[node.lockedAtColumn];
  if (!(lockedAt instanceof Date)) {
    return false;
  }

  const timeoutSeconds =
    typeof row[node.timeoutColumn] === 'number' ? (row[node.timeoutColumn] as number) : node.defaultSeconds;
  return lockedAt.getTime() + timeoutSeconds * 1_000 < Date.now();
}

function splitAndClauses(chunks: unknown[]): unknown[] {
  const clauses: unknown[] = [];

  for (let index = 0; index < chunks.length; index += 2) {
    clauses.push(chunks[index]);
    if (index < chunks.length - 1 && chunkText(chunks[index + 1]) !== ' and ') {
      throw new Error('Unsupported boolean expression in Stage 2 integration harness');
    }
  }

  return clauses;
}

function parseTtlSeconds(args: Array<string | number>): number | undefined {
  const ttlIndex = args.findIndex((entry) => entry === 'EX');
  return ttlIndex === -1 || typeof args[ttlIndex + 1] !== 'number' ? undefined : args[ttlIndex + 1];
}

function parseMode(args: Array<string | number>): 'NX' | 'XX' | undefined {
  return args.find((entry): entry is 'NX' | 'XX' => entry === 'NX' || entry === 'XX');
}

function getQueryChunks(value: unknown): unknown[] {
  if (!hasQueryChunks(value)) {
    return [];
  }

  return value.queryChunks;
}

function hasQueryChunks(value: unknown): value is { queryChunks: unknown[] } {
  return isRecord(value) && Array.isArray(value.queryChunks);
}

function chunkText(value: unknown): string {
  return isRecord(value) && Array.isArray(value.value) ? value.value.join('') : '';
}

function resolveColumnName(value: unknown): string | undefined {
  return isRecord(value) && typeof value.name === 'string' ? value.name : undefined;
}

function isParam(value: unknown): value is { value: unknown; encoder: unknown } {
  return isRecord(value) && 'encoder' in value && !Array.isArray(value.value);
}

function normalizeNumericChunk(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (isParam(value) && typeof value.value === 'number' && Number.isFinite(value.value)) {
    return value.value;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
