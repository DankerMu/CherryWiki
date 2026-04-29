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
import type { AuthenticatedRequestUser } from './jwt-auth.guard.js';
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

type RequestUser = AuthenticatedRequestUser & {
  permissions?: string[];
  space_permissions?: Record<string, string[]>;
};

type RequestWithAuth = {
  user?: RequestUser;
  params?: Record<string, string | undefined>;
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
    const user = request.user;
    if (user === undefined) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Unauthenticated',
      });
    }

    const role = normalizeRole(user.role);
    if (role === ROLES.OWNER) {
      return true;
    }

    if (role === undefined) {
      throwPermissionDenied();
    }

    const spaceId = getTargetSpaceId(request);
    const rolePermissions = new Set<string>(ROLE_PERMISSIONS[role]);
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
  if (params === undefined) {
    return undefined;
  }

  if (isNonEmptyString(params.space_id)) {
    return params.space_id;
  }

  if (isNonEmptyString(params.spaceId)) {
    return params.spaceId;
  }

  if (isNonEmptyString(params.id) && isSpaceRoute(request)) {
    return params.id;
  }

  return undefined;
}

function isSpaceRoute(request: RequestWithAuth): boolean {
  const routePath = request.routeOptions?.url ?? request.routerPath ?? request.url;
  return routePath === undefined || routePath.includes('/spaces') || routePath.includes(':space_id');
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function throwPermissionDenied(): never {
  throw new ForbiddenException({
    code: ErrorCode.PERMISSION_DENIED,
    message: 'Permission denied',
  });
}
