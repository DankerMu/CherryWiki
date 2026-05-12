import { describe, expect, it } from 'vitest';

import { PERMISSION_POINTS, REST_API_TOKEN_SCOPE_BY_PERMISSION, ROLE_PERMISSIONS, ROLES } from '../constants.js';

describe('auth constants', () => {
  it('defines all 16 permission points', () => {
    expect(PERMISSION_POINTS).toHaveLength(16);
  });

  it('defines all 6 roles', () => {
    expect(Object.values(ROLES)).toHaveLength(6);
  });

  it('grants all permissions to Owner', () => {
    expect(ROLE_PERMISSIONS[ROLES.OWNER]).toEqual(PERMISSION_POINTS);
  });

  it('grants upload permissions to admin and upload read to viewer', () => {
    expect(ROLE_PERMISSIONS[ROLES.ADMIN]).toEqual(expect.arrayContaining(['upload:create', 'upload:read']));
    expect(ROLE_PERMISSIONS[ROLES.VIEWER]).toContain('upload:read');
  });

  it('maps REST permission points to same-named API token scopes', () => {
    expect(REST_API_TOKEN_SCOPE_BY_PERMISSION).toMatchObject({
      'admin:user_manage': 'admin:user_manage',
      'upload:create': 'upload:create',
      'graphify:run': 'graphify:run',
    });
    expect(Object.hasOwn(REST_API_TOKEN_SCOPE_BY_PERMISSION, 'mcp:invoke')).toBe(false);
  });
});
