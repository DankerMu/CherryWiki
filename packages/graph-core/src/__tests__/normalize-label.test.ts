import { describe, expect, it } from 'vitest';

import { normalizeLabel } from '../normalize-label.js';

describe('normalizeLabel', () => {
  it('lowercases mixed case labels', () => {
    expect(normalizeLabel('Auth System')).toBe('auth system');
  });

  it('removes special characters', () => {
    expect(normalizeLabel('Auth/SSO Service v2.0')).toBe('authsso service v20');
  });

  it('removes unicode characters', () => {
    expect(normalizeLabel('数据库 Auth')).toBe('auth');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLabel('  Auth System  ')).toBe('auth system');
  });
});
