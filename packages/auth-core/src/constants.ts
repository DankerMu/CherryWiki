export const PERMISSION_POINTS = [
  'space:read',
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
  'admin',
  'admin:user_manage',
  'admin:model_manage',
  'admin:audit_view',
] as const;

export type PermissionPoint = (typeof PERMISSION_POINTS)[number];

/**
 * REST API token scope mapping.
 *
 * Ordinary REST route permission points use the same string as the required API
 * token scope. For example, an upload route decorated with `upload:create`
 * requires an API token containing `upload:create`; an admin user-management
 * route requires `admin:user_manage`; a graphify run route requires
 * `graphify:run`.
 *
 * MCP scopes such as `mcp:invoke` are intentionally absent from this table.
 * They are enforced by the MCP policy layer only and do not authorize REST
 * routes.
 */
export const REST_API_TOKEN_SCOPE_BY_PERMISSION = {
  'space:read': 'space:read',
  'space:view': 'space:view',
  'space:edit': 'space:edit',
  'space:admin': 'space:admin',
  'upload:create': 'upload:create',
  'upload:read': 'upload:read',
  'wiki:publish': 'wiki:publish',
  'wiki:rollback': 'wiki:rollback',
  'graphify:run': 'graphify:run',
  'graphify:view': 'graphify:view',
  'chat:use': 'chat:use',
  'model:use': 'model:use',
  admin: 'admin',
  'admin:user_manage': 'admin:user_manage',
  'admin:model_manage': 'admin:model_manage',
  'admin:audit_view': 'admin:audit_view',
} as const satisfies Record<PermissionPoint, PermissionPoint>;

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
    'space:read',
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
    'admin',
    'admin:user_manage',
    'admin:model_manage',
    'admin:audit_view',
  ],
  [ROLES.SPACE_ADMIN]: [
    'space:read',
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
    'space:read',
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
  [ROLES.VIEWER]: ['space:read', 'space:view', 'upload:read', 'chat:use', 'model:use'],
  [ROLES.AUDITOR]: ['space:read', 'space:view', 'admin:audit_view'],
} as const satisfies Record<Role, readonly PermissionPoint[]>;

export const SPACE_SCOPED_PERMISSIONS = [
  'space:read',
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

export function getRestApiTokenScopeForPermission(permission: string): PermissionPoint | undefined {
  return isPermissionPoint(permission) ? REST_API_TOKEN_SCOPE_BY_PERMISSION[permission] : undefined;
}
