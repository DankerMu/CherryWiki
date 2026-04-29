import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { buildPaginationMeta, PaginationQueryDto, parseSortField } from '../pagination.dto.js';

describe('PaginationQueryDto', () => {
  it('uses default values', async () => {
    const dto = plainToInstance(PaginationQueryDto, {});

    expect(dto.page).toBe(1);
    expect(dto.per_page).toBe(20);
    expect(dto.sort).toBe('-created_at');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects page values below 1', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '0' });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('rejects per_page values above 100', async () => {
    const dto = plainToInstance(PaginationQueryDto, { per_page: '101' });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});

describe('buildPaginationMeta', () => {
  it('calculates has_next when more records remain', () => {
    expect(buildPaginationMeta(1, 20, 100)).toEqual({
      page: 1,
      per_page: 20,
      total: 100,
      has_next: true,
    });
  });

  it('calculates has_next as false on the final page', () => {
    expect(buildPaginationMeta(5, 20, 100)).toEqual({
      page: 5,
      per_page: 20,
      total: 100,
      has_next: false,
    });
  });
});

describe('parseSortField', () => {
  it('parses ascending sort fields', () => {
    expect(parseSortField('created_at')).toEqual({
      field: 'created_at',
      direction: 'asc',
    });
  });

  it('parses descending sort fields', () => {
    expect(parseSortField('-created_at')).toEqual({
      field: 'created_at',
      direction: 'desc',
    });
  });

  it('rejects invalid sort field names', () => {
    expect(() => parseSortField('-')).toThrow('Invalid sort field');
    expect(() => parseSortField('created-at')).toThrow('Invalid sort field');
    expect(() => parseSortField('created at')).toThrow('Invalid sort field');
  });
});
