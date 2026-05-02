import { describe, expect, it } from 'vitest';

import { computeStableKey } from '../stable-key.js';

describe('computeStableKey', () => {
  it('returns the same 16-character hex key for the same input', () => {
    const key = computeStableKey('space-1', 'auth', 'module');

    expect(computeStableKey('space-1', 'auth', 'module')).toBe(key);
    expect(key).toMatch(/^[a-f0-9]{16}$/);
  });

  it('returns different keys for different node types', () => {
    expect(computeStableKey('s1', 'auth', 'module')).not.toBe(computeStableKey('s1', 'auth', 'concept'));
  });

  it('defaults empty nodeType to concept', () => {
    expect(computeStableKey('s1', 'auth', '')).toBe(computeStableKey('s1', 'auth', 'concept'));
  });
});
