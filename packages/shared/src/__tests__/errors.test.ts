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

  it('contains auth module error codes', () => {
    expect(ErrorCode.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
    expect(ErrorCode.ACCOUNT_LOCKED).toBe('ACCOUNT_LOCKED');
    expect(ErrorCode.ACCOUNT_DISABLED).toBe('ACCOUNT_DISABLED');
    expect(ErrorCode.INVALID_REFRESH_TOKEN).toBe('INVALID_REFRESH_TOKEN');
    expect(ErrorCode.TOKEN_REVOKED).toBe('TOKEN_REVOKED');
    expect(ErrorCode.INVALID_CURRENT_PASSWORD).toBe('INVALID_CURRENT_PASSWORD');
    expect(ErrorCode.PASSWORD_TOO_WEAK).toBe('PASSWORD_TOO_WEAK');
    expect(ErrorCode.SESSION_NOT_FOUND).toBe('SESSION_NOT_FOUND');
  });

  it('contains user and group management error codes', () => {
    expect(ErrorCode.USER_EMAIL_CONFLICT).toBe('USER_EMAIL_CONFLICT');
    expect(ErrorCode.USER_NOT_FOUND).toBe('USER_NOT_FOUND');
    expect(ErrorCode.INVALID_ROLE).toBe('INVALID_ROLE');
    expect(ErrorCode.GROUP_NOT_FOUND).toBe('GROUP_NOT_FOUND');
    expect(ErrorCode.GROUP_NAME_CONFLICT).toBe('GROUP_NAME_CONFLICT');
  });

  it('contains model config error codes', () => {
    expect(ErrorCode.MODEL_NOT_FOUND).toBe('MODEL_NOT_FOUND');
    expect(ErrorCode.MODEL_NAME_CONFLICT).toBe('MODEL_NAME_CONFLICT');
    expect(ErrorCode.SECRET_NOT_FOUND).toBe('SECRET_NOT_FOUND');
    expect(ErrorCode.MODEL_AUTH_FAILED).toBe('MODEL_AUTH_FAILED');
    expect(ErrorCode.EMBEDDING_LIMIT_EXCEEDED).toBe('EMBEDDING_LIMIT_EXCEEDED');
  });

  it('uses uppercase snake case for every value', () => {
    const uppercaseSnakeCase = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

    for (const code of Object.values(ErrorCode)) {
      expect(code).toMatch(uppercaseSnakeCase);
    }
  });
});
