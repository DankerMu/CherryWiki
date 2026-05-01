import { describe, expect, it } from 'vitest';

import { getNextVersionNo } from '../version.js';

describe('getNextVersionNo', () => {
  it('starts at 1 for empty version lists', () => {
    expect(getNextVersionNo([])).toBe(1);
  });

  it('increments consecutive versions', () => {
    expect(getNextVersionNo([1, 2])).toBe(3);
  });

  it('uses max plus one for unordered versions', () => {
    expect(getNextVersionNo([1, 3, 2])).toBe(4);
  });
});
