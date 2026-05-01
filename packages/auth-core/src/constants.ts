export const PERMISSION_POINTS = [
  'space:view',
  'space:edit',
  'space:admin',
  'upload:create',
  'upload:read',
  'wiki:publish',
  'wiki:rollback',
  'graphify:run',
  'graphify:view',
  'chat:use',
  'model:use',
  'admin:user_manage',
  'admin:model_manage',
  'admin:audit_view',
] as const;

export type PermissionPoint = (typeof PERMISSION_POINTS)[number];

export const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  SPACE_ADMIN: 'space_admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  AUDITOR: 'auditor',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_PERMISSIONS = {
  [ROLES.OWNER]: PERMISSION_POINTS,
  [ROLES.ADMIN]: [
    'space:view',
    'space:edit',
    'space:admin',
    'upload:create',
    'upload:read',
    'graphify:run',
    'graphify:view',
    'admin:user_manage',
    'admin:model_manage',
    'admin:audit_view',
  ],
  [ROLES.SPACE_ADMIN]: [
    'space:view',
    'space:edit',
    'space:admin',
    'upload:create',
    'upload:read',
    'wiki:publish',
    'wiki:rollback',
    'graphify:run',
    'graphify:view',
    'chat:use',
    'model:use',
  ],
  [ROLES.EDITOR]: [
    'space:view',
    'space:edit',
    'upload:create',
    'upload:read',
    'wiki:publish',
    'graphify:run',
    'graphify:view',
    'chat:use',
    'model:use',
  ],
  [ROLES.VIEWER]: ['space:view', 'upload:read', 'chat:use', 'model:use'],
  [ROLES.AUDITOR]: ['space:view', 'admin:audit_view'],
} as const satisfies Record<Role, readonly PermissionPoint[]>;

export const SPACE_SCOPED_PERMISSIONS = [
  'space:view',
  'space:edit',
  'space:admin',
  'upload:create',
  'upload:read',
  'wiki:publish',
  'wiki:rollback',
  'graphify:run',
  'graphify:view',
] as const satisfies readonly PermissionPoint[];

const ROLE_ALIASES = new Map<string, Role>([
  ['owner', ROLES.OWNER],
  ['admin', ROLES.ADMIN],
  ['space admin', ROLES.SPACE_ADMIN],
  ['space_admin', ROLES.SPACE_ADMIN],
  ['space-admin', ROLES.SPACE_ADMIN],
  ['spaceadmin', ROLES.SPACE_ADMIN],
  ['editor', ROLES.EDITOR],
  ['viewer', ROLES.VIEWER],
  ['auditor', ROLES.AUDITOR],
]);

export function normalizeRole(role: string): Role | undefined {
  return ROLE_ALIASES.get(role.trim().toLowerCase());
}

export function isPermissionPoint(permission: string): permission is PermissionPoint {
  return (PERMISSION_POINTS as readonly string[]).includes(permission);
}

export function isSpaceScopedPermission(permission: string): permission is (typeof SPACE_SCOPED_PERMISSIONS)[number] {
  return (SPACE_SCOPED_PERMISSIONS as readonly string[]).includes(permission);
}
