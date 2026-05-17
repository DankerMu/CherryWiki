import { describe, expect, it } from 'vitest';

import {
  SPACE_ADMIN_PERMISSIONS,
  SPACE_EDIT_PERMISSIONS,
  SPACE_VIEW_PERMISSIONS,
  UPLOAD_CREATE_PERMISSIONS,
  UPLOAD_READ_PERMISSIONS,
} from '../permission-constants.js';

describe('shared permission constants', () => {
  it('includes space:read in space view permissions', () => {
    expect(SPACE_VIEW_PERMISSIONS).toContain('space:read');
  });

  it('keeps space:view as a backward-compatible view permission', () => {
    expect(SPACE_VIEW_PERMISSIONS).toContain('space:view');
  });

  it('includes space:read in upload read permissions', () => {
    expect(UPLOAD_READ_PERMISSIONS).toContain('space:read');
  });

  it('exposes permission arrays as readonly tuples at compile time', () => {
    expect(true).toBe(true);
  });

  it('does not duplicate entries in any permission array', () => {
    const permissionArrays = [
      SPACE_VIEW_PERMISSIONS,
      SPACE_EDIT_PERMISSIONS,
      SPACE_ADMIN_PERMISSIONS,
      UPLOAD_READ_PERMISSIONS,
      UPLOAD_CREATE_PERMISSIONS,
    ];

    for (const permissions of permissionArrays) {
      expect(new Set(permissions).size).toBe(permissions.length);
    }
  });
});

function acceptsMutablePermissions(permissions: string[]): void {
  void permissions;
}

// @ts-expect-error readonly tuple cannot be passed as a mutable array
acceptsMutablePermissions(SPACE_VIEW_PERMISSIONS);
// @ts-expect-error readonly tuple cannot be passed as a mutable array
acceptsMutablePermissions(SPACE_EDIT_PERMISSIONS);
// @ts-expect-error readonly tuple cannot be passed as a mutable array
acceptsMutablePermissions(SPACE_ADMIN_PERMISSIONS);
// @ts-expect-error readonly tuple cannot be passed as a mutable array
acceptsMutablePermissions(UPLOAD_READ_PERMISSIONS);
// @ts-expect-error readonly tuple cannot be passed as a mutable array
acceptsMutablePermissions(UPLOAD_CREATE_PERMISSIONS);
