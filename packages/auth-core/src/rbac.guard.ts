import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@cherrygraph/shared';

import {
  ROLE_PERMISSIONS,
  ROLES,
  isSpaceScopedPermission,
  normalizeRole,
  type Role,
} from './constants.js';
import { PERMISSIONS_METADATA_KEY } from './permissions.decorator.js';

export const SPACE_PERMISSION_RESOLVER = Symbol('SPACE_PERMISSION_RESOLVER');

export type SpacePermissionResolverInput = {
  tenantId: string;
  userId: string;
  groupIds: string[];
  spaceId: string;
  requiredPermissions: string[];
};

export type SpacePermissionResolver = {
  getPermissionsForUser: (input: SpacePermissionResolverInput) => Promise<readonly string[]>;
};

type RequestUser = {
  sub?: string;
  tenant_id?: string;
  role: string;
  group_ids: string[];
  permissions?: string[];
  space_permissions?: Record<string, string[]>;
};

type RequestWithAuth = {
  user?: unknown;
  params?: Record<string, string | null | undefined>;
  body?: Record<string, unknown>;
  routeOptions?: {
    url?: string;
  };
  routerPath?: string;
  url?: string;
  permissions?: string[];
  space_permissions?: Record<string, string[]>;
};

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(SPACE_PERMISSION_RESOLVER) private readonly resolver?: SpacePermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredPermissions === undefined || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = getValidatedRequestUser(request.user);

    const role = normalizeRole(user.role);
    if (role === ROLES.OWNER) {
      return true;
    }

    if (role === undefined) {
      throwPermissionDenied();
    }

    const spaceId = getTargetSpaceId(request);
    const rolePermissions = new Set<string>(ROLE_PERMISSIONS[role]);

    if (spaceId === undefined && requiredPermissions.some(isSpaceScopedPermission)) {
      if (
        role !== ROLES.ADMIN ||
        !requiredPermissions.every((permission) => isSpaceScopedPermission(permission) || rolePermissions.has(permission))
      ) {
        throwPermissionDenied();
      }

      return true;
    }

    const requestPermissions = await getRequestPermissions(request, user, spaceId, requiredPermissions, this.resolver);

    const allowed = requiredPermissions.every((permission) =>
      hasPermission({
        permission,
        role,
        rolePermissions,
        requestPermissions,
        spaceId,
      }),
    );

    if (!allowed) {
      throwPermissionDenied();
    }

    return true;
  }
}

type HasPermissionInput = {
  permission: string;
  role: Role;
  rolePermissions: Set<string>;
  requestPermissions: readonly string[];
  spaceId: string | undefined;
};

function hasPermission(input: HasPermissionInput): boolean {
  if (input.role === ROLES.ADMIN && input.rolePermissions.has(input.permission)) {
    return true;
  }

  if (!input.rolePermissions.has(input.permission)) {
    return false;
  }

  if (!isSpaceScopedPermission(input.permission) || input.spaceId === undefined) {
    return true;
  }

  return permissionSetSatisfies(input.requestPermissions, input.permission);
}

function permissionSetSatisfies(grantedPermissions: readonly string[], requiredPermission: string): boolean {
  return grantedPermissions.includes(requiredPermission) || grantedPermissions.includes('space:admin');
}

async function getRequestPermissions(
  request: RequestWithAuth,
  user: RequestUser,
  spaceId: string | undefined,
  requiredPermissions: string[],
  resolver: SpacePermissionResolver | undefined,
): Promise<readonly string[]> {
  if (spaceId !== undefined) {
    const directPermissions = request.space_permissions?.[spaceId] ?? user.space_permissions?.[spaceId];
    if (directPermissions !== undefined) {
      return directPermissions;
    }

    if (resolver !== undefined) {
      if (!isNonEmptyString(user.tenant_id) || !isNonEmptyString(user.sub)) {
        throwUnauthenticated();
      }

      return resolver.getPermissionsForUser({
        tenantId: user.tenant_id,
        userId: user.sub,
        groupIds: user.group_ids,
        spaceId,
        requiredPermissions,
      });
    }
  }

  return request.permissions ?? user.permissions ?? [];
}

function getTargetSpaceId(request: RequestWithAuth): string | undefined {
  const params = request.params;
  if (isNonEmptyString(params?.space_id)) {
    return params.space_id;
  }

  if (isNonEmptyString(params?.spaceId)) {
    return params.spaceId;
  }

  if (isNonEmptyString(params?.id) && isSpaceRoute(request)) {
    return params.id;
  }

  if (isNonEmptyString(request.body?.space_id)) {
    return request.body.space_id;
  }

  if (isNonEmptyString(request.body?.spaceId)) {
    return request.body.spaceId;
  }

  return undefined;
}

function isSpaceRoute(request: RequestWithAuth): boolean {
  const routePath = request.routeOptions?.url ?? request.routerPath ?? request.url;
  return routePath === undefined || routePath.includes('/spaces') || routePath.includes(':space_id');
}

function getValidatedRequestUser(user: unknown): RequestUser {
  if (!isRecord(user) || !isNonEmptyString(user.role)) {
    throwUnauthenticated();
  }

  const groupIds = user.group_ids;
  if (groupIds !== undefined && !isStringArray(groupIds)) {
    throwUnauthenticated();
  }

  const requestUser: RequestUser = {
    role: user.role,
    group_ids: groupIds ?? [],
  };

  if (isNonEmptyString(user.sub)) {
    requestUser.sub = user.sub;
  }

  if (isNonEmptyString(user.tenant_id)) {
    requestUser.tenant_id = user.tenant_id;
  }

  if (user.permissions !== undefined) {
    if (!isStringArray(user.permissions)) {
      throwUnauthenticated();
    }

    requestUser.permissions = user.permissions;
  }

  if (user.space_permissions !== undefined) {
    if (!isPermissionMap(user.space_permissions)) {
      throwUnauthenticated();
    }

    requestUser.space_permissions = user.space_permissions;
  }

  return requestUser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPermissionMap(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function throwUnauthenticated(): never {
  throw new UnauthorizedException({
    code: ErrorCode.UNAUTHENTICATED,
    message: 'Unauthenticated',
  });
}

function throwPermissionDenied(): never {
  throw new ForbiddenException({
    code: ErrorCode.PERMISSION_DENIED,
    message: 'Permission denied',
  });
}
