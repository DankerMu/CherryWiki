import { describe, expect, it } from 'vitest';

import { generatePageId } from '../page-id.js';

describe('generatePageId', () => {
  it('generates community page ids', () => {
    expect(generatePageId('rd-platform', 'community', 'community_1')).toBe('rd-platform.community.community_1');
  });

  it('generates index page ids', () => {
    expect(generatePageId('rd-platform', 'index', 'root')).toBe('rd-platform.index.root');
  });

  it('generates god node page ids', () => {
    expect(generatePageId('rd-platform', 'god_node', 'a1b2c3d4e5f6')).toBe('rd-platform.god-node.a1b2c3d4e5f6');
  });

  it('generates article page ids', () => {
    expect(generatePageId('rd-platform', 'generated_article', 'abc123def456')).toBe('rd-platform.page.abc123def456');
  });
});
