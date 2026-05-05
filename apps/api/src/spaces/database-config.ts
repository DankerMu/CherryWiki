import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { sql, type SQL } from 'drizzle-orm';

export type SpaceDatabaseConfig = {
  enabled: boolean;
  dsn?: string;
  allowed_tables?: string[];
  masked_columns?: string[];
};

type DatabaseExecutor = {
  execute: (query: SQL) => Promise<{ rows: unknown[] } | unknown[]>;
};

type DecryptedDsnRow = {
  dsn: string | null;
};

const ENCRYPTED_DSN_PREFIX = 'pgp:';
const MAX_DSN_LENGTH = 4096;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_LIST_LENGTH = 500;
const TRUSTED_ENCRYPTED_DSN = Symbol('trustedEncryptedDsn');

type StorageSpaceDatabaseConfig = SpaceDatabaseConfig & {
  [TRUSTED_ENCRYPTED_DSN]?: boolean;
};

export function normalizeSpaceDatabaseConfig(value: unknown): SpaceDatabaseConfig {
  if (!isRecord(value)) {
    return { enabled: false };
  }

  return {
    enabled: value.enabled === true,
    ...(typeof value.dsn === 'string' && value.dsn.length > 0 ? { dsn: value.dsn } : {}),
    ...normalizeOptionalStringListField(value, 'allowed_tables', 'allowedTables'),
    ...normalizeOptionalStringListField(value, 'masked_columns', 'maskedColumns'),
  };
}

export function validateSpaceDatabaseConfig(value: unknown): SpaceDatabaseConfig {
  if (!isRecord(value)) {
    throwValidationError('database_config must be an object');
  }

  if (typeof value.enabled !== 'boolean') {
    throwValidationError('database_config.enabled must be a boolean');
  }

  const config: SpaceDatabaseConfig = { enabled: value.enabled };

  if (value.dsn !== undefined) {
    if (typeof value.dsn !== 'string' || value.dsn.length > MAX_DSN_LENGTH) {
      throwValidationError('database_config.dsn must be a string up to 4096 characters');
    }

    if (value.dsn.trim().length > 0) {
      config.dsn = value.dsn.trim();
    }
  }

  if (value.allowed_tables !== undefined) {
    config.allowed_tables = validateStringList(value.allowed_tables, 'database_config.allowed_tables');
  }

  if (value.masked_columns !== undefined) {
    config.masked_columns = validateStringList(value.masked_columns, 'database_config.masked_columns');
  }

  return config;
}

export function mergeSpaceDatabaseConfig(existingValue: unknown, patchValue: unknown): SpaceDatabaseConfig {
  const existing = normalizeSpaceDatabaseConfig(existingValue);
  const patch = validateSpaceDatabaseConfig(patchValue);
  const patchRecord = patchValue as Record<string, unknown>;
  const next: SpaceDatabaseConfig = {
    enabled: patch.enabled,
  };

  if ('dsn' in patchRecord) {
    if (patch.dsn !== undefined && patch.dsn !== '***') {
      next.dsn = patch.dsn;
    } else if (patch.dsn === '***' && existing.dsn !== undefined) {
      next.dsn = existing.dsn;
    }
  } else if (existing.dsn !== undefined) {
    next.dsn = existing.dsn;
  }

  if (
    existing.dsn !== undefined &&
    next.dsn === existing.dsn &&
    isEncryptedDsn(existing.dsn) &&
    (patch.dsn === undefined || patch.dsn === '***')
  ) {
    (next as StorageSpaceDatabaseConfig)[TRUSTED_ENCRYPTED_DSN] = true;
  }

  if ('allowed_tables' in patchRecord) {
    next.allowed_tables = patch.allowed_tables ?? [];
  } else if (existing.allowed_tables !== undefined) {
    next.allowed_tables = existing.allowed_tables;
  }

  if ('masked_columns' in patchRecord) {
    next.masked_columns = patch.masked_columns ?? [];
  } else if (existing.masked_columns !== undefined) {
    next.masked_columns = existing.masked_columns;
  }

  if (next.enabled && next.dsn === undefined) {
    throwValidationError('database_config.dsn is required when database_config.enabled is true');
  }

  return next;
}

export function maskSpaceDatabaseConfig(value: unknown): SpaceDatabaseConfig {
  const config = normalizeSpaceDatabaseConfig(value);
  return {
    enabled: config.enabled,
    ...(config.dsn !== undefined ? { dsn: '***' } : {}),
    ...(config.allowed_tables !== undefined ? { allowed_tables: config.allowed_tables } : {}),
    ...(config.masked_columns !== undefined ? { masked_columns: config.masked_columns } : {}),
  };
}

export function databaseConfigStorageValue(config: SpaceDatabaseConfig): SQL {
  const entries: SQL[] = [sql`'enabled', ${config.enabled}`];

  if (config.dsn !== undefined) {
    entries.push(
      sql`'dsn', ${
        isTrustedEncryptedDsn(config) ? sql`${config.dsn}` : encryptedDsnExpression(config.dsn)
      }`,
    );
  }

  if (config.allowed_tables !== undefined) {
    entries.push(sql`'allowed_tables', to_jsonb(${toPgTextArray(config.allowed_tables)})`);
  }

  if (config.masked_columns !== undefined) {
    entries.push(sql`'masked_columns', to_jsonb(${toPgTextArray(config.masked_columns)})`);
  }

  return sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(entries, sql`, `)}))`;
}

export async function decryptSpaceDatabaseConfig(
  db: DatabaseExecutor,
  value: unknown,
): Promise<SpaceDatabaseConfig> {
  const config = normalizeSpaceDatabaseConfig(value);
  if (config.dsn === undefined || !isEncryptedDsn(config.dsn)) {
    return config;
  }

  const key = getEncryptionKey();
  const encryptedPayload = config.dsn.slice(ENCRYPTED_DSN_PREFIX.length);
  const result = await db.execute(sql`SELECT pgp_sym_decrypt(decode(${encryptedPayload}, 'base64'), ${key}) AS dsn`);
  const rows = Array.isArray(result) ? result : result.rows;
  const firstRow = rows[0];
  const dsn = isRecord(firstRow) ? (firstRow as DecryptedDsnRow).dsn : null;
  if (typeof dsn !== 'string' || dsn.length === 0) {
    throw new Error('Failed to decrypt space database DSN');
  }

  return {
    ...config,
    dsn,
  };
}

function encryptedDsnExpression(dsn: string): SQL {
  return sql`${ENCRYPTED_DSN_PREFIX} || encode(pgp_sym_encrypt(${dsn}, ${getEncryptionKey()}), 'base64')`;
}

function getEncryptionKey(): string {
  const key = process.env.DB_ENCRYPTION_KEY;
  if (key === undefined || key.trim().length === 0) {
    throw new Error('DB_ENCRYPTION_KEY is required for space database DSN encryption');
  }

  return key;
}

function isEncryptedDsn(value: string): boolean {
  return value.startsWith(ENCRYPTED_DSN_PREFIX);
}

function isTrustedEncryptedDsn(config: SpaceDatabaseConfig): boolean {
  return (
    config.dsn !== undefined &&
    isEncryptedDsn(config.dsn) &&
    (config as StorageSpaceDatabaseConfig)[TRUSTED_ENCRYPTED_DSN] === true
  );
}

function normalizeOptionalStringListField(
  record: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
): Partial<Pick<SpaceDatabaseConfig, 'allowed_tables' | 'masked_columns'>> {
  const value = record[snakeKey] ?? record[camelKey];
  if (!Array.isArray(value)) {
    return {};
  }

  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return snakeKey === 'allowed_tables' ? { allowed_tables: list } : { masked_columns: list };
}

function validateStringList(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST_LENGTH) {
    throwValidationError(`${fieldName} must be an array with at most ${MAX_LIST_LENGTH} items`);
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0 || item.length > MAX_IDENTIFIER_LENGTH) {
      throwValidationError(`${fieldName} items must be non-empty strings up to ${MAX_IDENTIFIER_LENGTH} characters`);
    }

    result.push(item.trim());
  }

  return [...new Set(result)];
}

function toPgTextArray(values: string[]): SQL {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }

  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function throwValidationError(message: string): never {
  throw new HttpException({ code: ErrorCode.VALIDATION_ERROR, message }, HttpStatus.UNPROCESSABLE_ENTITY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
