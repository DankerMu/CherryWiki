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
    expect(ErrorCode.NO_CHAT_MODEL_CONFIGURED).toBe('NO_CHAT_MODEL_CONFIGURED');
  });

  it('contains upload module error codes', () => {
    expect(ErrorCode.FILE_TOO_LARGE).toBe('FILE_TOO_LARGE');
    expect(ErrorCode.UNSUPPORTED_FILE_TYPE).toBe('UNSUPPORTED_FILE_TYPE');
    expect(ErrorCode.DUPLICATE_FILE).toBe('DUPLICATE_FILE');
    expect(ErrorCode.INVALID_URL_FORMAT).toBe('INVALID_URL_FORMAT');
    expect(ErrorCode.INVALID_URL_PROTOCOL).toBe('INVALID_URL_PROTOCOL');
    expect(ErrorCode.UPLOAD_NOT_FOUND).toBe('UPLOAD_NOT_FOUND');
    expect(ErrorCode.ILLEGAL_STATUS_TRANSITION).toBe('ILLEGAL_STATUS_TRANSITION');
    expect(ErrorCode.MIME_MISMATCH).toBe('MIME_MISMATCH');
    expect(ErrorCode.ZIP_BOMB_DETECTED).toBe('ZIP_BOMB_DETECTED');
    expect(ErrorCode.PATH_TRAVERSAL_DETECTED).toBe('PATH_TRAVERSAL_DETECTED');
    expect(ErrorCode.ZIP_NESTING_EXCEEDED).toBe('ZIP_NESTING_EXCEEDED');
    expect(ErrorCode.ZIP_SYMLINK_DETECTED).toBe('ZIP_SYMLINK_DETECTED');
    expect(ErrorCode.PROMPT_INJECTION_DETECTED).toBe('PROMPT_INJECTION_DETECTED');
  });

  it('contains wiki module error codes', () => {
    expect(ErrorCode.WIKI_PAGE_NOT_FOUND).toBe('WIKI_PAGE_NOT_FOUND');
    expect(ErrorCode.VERSION_NOT_FOUND).toBe('VERSION_NOT_FOUND');
    expect(ErrorCode.VERSION_ALREADY_PUBLISHED).toBe('VERSION_ALREADY_PUBLISHED');
  });

  it('contains graphify module error codes', () => {
    expect(ErrorCode.GRAPHIFY_RUN_NOT_FOUND).toBe('GRAPHIFY_RUN_NOT_FOUND');
    expect(ErrorCode.GRAPHIFY_RUN_IN_PROGRESS).toBe('GRAPHIFY_RUN_IN_PROGRESS');
    expect(ErrorCode.GRAPHIFY_RUN_NOT_CANCELLABLE).toBe('GRAPHIFY_RUN_NOT_CANCELLABLE');
    expect(ErrorCode.GRAPHIFY_RUN_NOT_RETRYABLE).toBe('GRAPHIFY_RUN_NOT_RETRYABLE');
  });

  it('contains feedback module error codes', () => {
    expect(ErrorCode.FEEDBACK_NOT_FOUND).toBe('FEEDBACK_NOT_FOUND');
    expect(ErrorCode.FEEDBACK_ALREADY_RESOLVED).toBe('FEEDBACK_ALREADY_RESOLVED');
    expect(ErrorCode.FEEDBACK_TARGET_REQUIRED).toBe('FEEDBACK_TARGET_REQUIRED');
  });

  it('uses uppercase snake case for every value', () => {
    const uppercaseSnakeCase = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

    for (const code of Object.values(ErrorCode)) {
      expect(code).toMatch(uppercaseSnakeCase);
    }
  });
});
