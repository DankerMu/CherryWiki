import { describe, expect, it } from 'vitest';

import { safeFilename, uniqueSlug } from '../normalization/safe-filename.js';

describe('normalization safe filename', () => {
  it('replaces spaces with underscores', () => {
    expect(safeFilename('Auth SSO Service')).toBe('Auth_SSO_Service');
  });

  it('replaces slashes and colons with hyphens', () => {
    expect(safeFilename('Auth/SSO: Service')).toBe('Auth-SSO-_Service');
  });

  it('preserves unicode characters', () => {
    expect(safeFilename('数据库 设计')).toBe('数据库_设计');
  });

  it('returns the same slug when there is no collision', () => {
    expect(uniqueSlug('auth', new Set())).toBe('auth');
  });

  it('appends _2 for the first collision', () => {
    expect(uniqueSlug('auth', new Set(['auth']))).toBe('auth_2');
  });

  it('appends _3 for a double collision', () => {
    expect(uniqueSlug('auth', new Set(['auth', 'auth_2']))).toBe('auth_3');
  });
});
