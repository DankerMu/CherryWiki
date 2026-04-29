import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page = 20;

  @IsOptional()
  @IsString()
  sort = '-created_at';
}

export type PaginationMeta = {
  page: number;
  per_page: number;
  total: number;
  has_next: boolean;
};

export type SortDirection = 'asc' | 'desc';

export type ParsedSortField = {
  field: string;
  direction: SortDirection;
};

const PAGINATED_RESPONSE_MARKER = Symbol('PAGINATED_RESPONSE_MARKER');
const SORT_FIELD_PATTERN = /^[A-Za-z0-9_]+$/;

export type PaginatedResponse<T> = {
  readonly [PAGINATED_RESPONSE_MARKER]: true;
  readonly data: T[];
  readonly pagination: PaginationMeta;
};

export function buildPaginationMeta(page: number, perPage: number, total: number): PaginationMeta {
  return {
    page,
    per_page: perPage,
    total,
    has_next: page * perPage < total,
  };
}

export function parseSortField(sort: string): ParsedSortField {
  const direction: SortDirection = sort.startsWith('-') ? 'desc' : 'asc';
  const field = direction === 'desc' ? sort.slice(1) : sort;

  if (!SORT_FIELD_PATTERN.test(field)) {
    throw new Error('Invalid sort field');
  }

  return { field, direction };
}

export function paginatedResponse<T>(data: T[], pagination: PaginationMeta): PaginatedResponse<T> {
  return {
    [PAGINATED_RESPONSE_MARKER]: true,
    data,
    pagination,
  };
}

export function isPaginatedResponse(value: unknown): value is PaginatedResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<PaginatedResponse<unknown>>)[PAGINATED_RESPONSE_MARKER] === true
  );
}
