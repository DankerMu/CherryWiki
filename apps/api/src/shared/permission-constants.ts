/** Permissions that satisfy "can view this space" checks */
export const SPACE_VIEW_PERMISSIONS = ['space:read', 'space:view', 'space:edit', 'space:admin'] as const;

/** Permissions that satisfy "can edit this space" checks */
export const SPACE_EDIT_PERMISSIONS = ['space:edit', 'space:admin'] as const;

/** Permissions that satisfy "can admin this space" checks */
export const SPACE_ADMIN_PERMISSIONS = ['space:admin'] as const;

/** Permissions that satisfy "can read uploads" checks */
export const UPLOAD_READ_PERMISSIONS = [
  'upload:read',
  'upload:create',
  'space:read',
  'space:view',
  'space:edit',
  'space:admin',
] as const;

/** Permissions that satisfy "can create uploads" checks */
export const UPLOAD_CREATE_PERMISSIONS = ['upload:create', 'space:edit', 'space:admin'] as const;
