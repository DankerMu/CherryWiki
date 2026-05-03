import { describe, expect, it } from 'vitest';

import { buildAclJson } from '../acl-builder.js';

describe('buildAclJson', () => {
  it('builds the ACL envelope from page, version, space config, and group deps', async () => {
    await expect(
      buildAclJson(
        {
          tenant_id: 'tenant-1',
          space_id: 'space-1',
          page_id: 'page-1',
        },
        {
          version_no: 7,
        },
        {
          classification: 'confidential',
        },
        {
          getAllowedGroupIds: (spaceId) => (spaceId === 'space-1' ? ['group-1', 'group-2'] : []),
        },
      ),
    ).resolves.toEqual({
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      allowed_group_ids: ['group-1', 'group-2'],
      classification: 'confidential',
      page_id: 'page-1',
      page_version: 7,
    });
  });

  it('defaults classification to internal', async () => {
    const acl = await buildAclJson(
      {
        tenant_id: 'tenant-1',
        space_id: 'space-1',
        page_id: 'page-1',
      },
      {
        version_no: 1,
      },
      {},
      {
        getAllowedGroupIds: () => [],
      },
    );

    expect(acl.classification).toBe('internal');
  });
});
