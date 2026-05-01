import { describe, expect, it } from 'vitest';

import { generateSlug } from '../slug.js';

describe('generateSlug', () => {
  it('replaces spaces with underscores', () => {
    expect(generateSlug('Hello World')).toBe('Hello_World');
  });

  it('replaces slash and colon with hyphens', () => {
    expect(generateSlug('auth/token:service')).toBe('auth-token-service');
  });

  it('deduplicates once', () => {
    expect(generateSlug('Hello World', ['Hello_World'])).toBe('Hello_World_2');
  });

  it('deduplicates repeatedly', () => {
    expect(generateSlug('Hello World', ['Hello_World', 'Hello_World_2'])).toBe('Hello_World_3');
  });

  it('preserves Chinese characters', () => {
    expect(generateSlug('数据库设计')).toBe('数据库设计');
  });

  it('handles empty strings', () => {
    expect(generateSlug('')).toBe('');
  });
});
