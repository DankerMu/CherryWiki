import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../errors.js';

describe('ErrorCode', () => {
  it('contains the required generic API error codes', () => {
    expect(ErrorCode.UNAUTHENTICATED).toBe('UNAUTHENTICATED');
    expect(ErrorCode.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
    expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
    expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCode.RATE_LIMITED).toBe('RATE_LIMITED');
    expect(ErrorCode.CONFLICT).toBe('CONFLICT');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });

  it('uses uppercase snake case for every value', () => {
    const uppercaseSnakeCase = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

    for (const code of Object.values(ErrorCode)) {
      expect(code).toMatch(uppercaseSnakeCase);
    }
  });
});
