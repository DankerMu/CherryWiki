import { describe, expect, it } from 'vitest';

import { generateFrontmatter, parseFrontmatter } from '../frontmatter.js';
import type { WikiFrontmatter } from '../types.js';

const fullFrontmatter: WikiFrontmatter = {
  page_id: 'rd-platform.community.community_1',
  title: 'Community: Auth / Token Service',
  space_id: 'rd-platform',
  page_type: 'community',
  status: 'draft',
  curation_status: 'auto_generated',
  source: 'graphify',
  graphify_run_id: 'run-1',
  graphify_schema_version: '0.5.3',
  managed_by: 'graphify',
  source_document_ids: ['doc-1', 'doc-2'],
  graph_node_ids: ['node-1', 'node-2'],
  version: 1,
  acl_hash: '',
  created_by: 'user-1',
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
};

describe('frontmatter', () => {
  it('parses valid frontmatter with all Doc 21 fields', () => {
    const markdown = generateFrontmatter(fullFrontmatter, '# Content');
    const parsed = parseFrontmatter(markdown);

    expect(parsed.frontmatter).toEqual(fullFrontmatter);
    expect(parsed.content).toBe('# Content');
  });

  it('returns empty frontmatter for markdown without frontmatter', () => {
    expect(parseFrontmatter('# Just content')).toEqual({
      frontmatter: {},
      content: '# Just content',
    });
  });

  it('returns empty frontmatter for empty frontmatter', () => {
    expect(parseFrontmatter('---\n---\n# Content')).toEqual({
      frontmatter: {},
      content: '# Content',
    });
  });

  it('preserves all fields through generate and parse', () => {
    const markdown = generateFrontmatter(fullFrontmatter, 'Body');

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: fullFrontmatter,
      content: 'Body',
    });
  });

  it('handles special characters in title', () => {
    const frontmatter = {
      ...fullFrontmatter,
      title: 'Auth: token/service & 数据库设计',
    };
    const parsed = parseFrontmatter(generateFrontmatter(frontmatter, 'Content'));

    expect(parsed.frontmatter.title).toBe('Auth: token/service & 数据库设计');
  });
});
