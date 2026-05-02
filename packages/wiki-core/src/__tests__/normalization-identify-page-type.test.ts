import { describe, expect, it } from 'vitest';

import { identifyPageType } from '../normalization/identify-page-type.js';

describe('identifyPageType', () => {
  it('identifies index.md as the index page', () => {
    expect(identifyPageType('index.md', [], [])).toBe('index');
  });

  it('identifies community pages after safeFilename conversion', () => {
    expect(identifyPageType('Auth_System.md', ['Auth System'], [])).toBe('community');
  });

  it('identifies god node pages after safeFilename conversion', () => {
    expect(identifyPageType('JWT_Authentication.md', [], ['JWT Authentication'])).toBe('god_node');
  });

  it('also matches fixture-style lowercase hyphen filenames', () => {
    expect(identifyPageType('jwt-authentication.md', [], ['JWT Authentication'])).toBe('god_node');
  });

  it('falls back to generated articles for unmatched pages', () => {
    expect(identifyPageType('upload-pipeline.md', ['Auth System'], ['JWT Authentication'])).toBe('generated_article');
  });
});
