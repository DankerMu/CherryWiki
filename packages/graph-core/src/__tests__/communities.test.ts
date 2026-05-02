import { describe, expect, it } from 'vitest';

import { mergeCommunities } from '../communities.js';
import type { GraphNode } from '../types.js';

function node(id: string, community: string | null): GraphNode {
  return {
    id,
    label: id,
    norm_label: id,
    type: 'concept',
    community,
  };
}

describe('mergeCommunities', () => {
  it('groups nodes by community field', () => {
    expect(
      mergeCommunities([
        node('n1', 'auth_system'),
        node('n2', 'auth_system'),
        node('n3', 'auth_system'),
        node('n4', 'ingestion'),
        node('n5', 'ingestion'),
      ]),
    ).toEqual([
      { community_key: 'auth_system', label: 'auth_system', node_count: 3 },
      { community_key: 'ingestion', label: 'ingestion', node_count: 2 },
    ]);
  });

  it('excludes nodes with null community', () => {
    expect(mergeCommunities([node('n1', null), node('n2', 'auth_system')])).toEqual([
      { community_key: 'auth_system', label: 'auth_system', node_count: 1 },
    ]);
  });
});
