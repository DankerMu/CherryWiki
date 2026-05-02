import { describe, expect, it } from 'vitest';

import { sanitizeMarkdown } from '../normalization/sanitize-markdown.js';

describe('sanitizeMarkdown', () => {
  it('removes script tags and their content', () => {
    expect(sanitizeMarkdown('# Title\n<script>alert("xss")</script>\nBody')).toBe('# Title\n\nBody');
  });

  it('preserves graphify comments while stripping other HTML tags', () => {
    const sanitized = sanitizeMarkdown('<!-- graphify:managed:start id="a" run="r" --><b>Bold</b><!-- note -->');

    expect(sanitized).toContain('<!-- graphify:managed:start id="a" run="r" -->');
    expect(sanitized).toContain('Bold');
    expect(sanitized).not.toContain('<b>');
    expect(sanitized).not.toContain('<!-- note -->');
  });

  it('removes data URIs from HTML attributes and markdown images', () => {
    const sanitized = sanitizeMarkdown('<img src="data:text/html;base64,abc">\n![x](data:image/png;base64,abc)');

    expect(sanitized).not.toContain('data:');
  });

  it('removes event handler attributes', () => {
    const sanitized = sanitizeMarkdown('<a href="https://example.com" onclick="alert(1)">link</a>');

    expect(sanitized).toBe('link');
    expect(sanitized).not.toContain('onclick');
  });

  it('removes iframe object and embed tags completely', () => {
    const sanitized = sanitizeMarkdown('<iframe src="x">bad</iframe><object>bad</object><embed src="x">ok');

    expect(sanitized).toBe('ok');
    expect(sanitized).not.toContain('bad');
  });

  it('removes javascript markdown links but preserves link text', () => {
    expect(sanitizeMarkdown('[click](javascript:alert(1))')).toBe('click');
  });
});
