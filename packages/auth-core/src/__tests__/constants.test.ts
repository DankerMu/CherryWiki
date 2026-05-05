import { describe, expect, it } from 'vitest';

import { PERMISSION_POINTS, ROLE_PERMISSIONS, ROLES } from '../constants.js';

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
});
