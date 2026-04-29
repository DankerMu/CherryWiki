import { Inject, Injectable } from '@nestjs/common';
import { group_members, space_permissions } from '@cherrygraph/shared';
import {
  and,
  eq,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  SpacePermissionResolver,
  SpacePermissionResolverInput,
} from '@cherrygraph/auth-core';

import { DRIZZLE } from '../database/drizzle.constants.js';

type ResolverDatabase = NodePgDatabase;

@Injectable()
export class DrizzleSpacePermissionResolver implements SpacePermissionResolver {
  constructor(@Inject(DRIZZLE) private readonly db: ResolverDatabase) {}

  async getPermissionsForUser(input: SpacePermissionResolverInput): Promise<readonly string[]> {
    const rows = await this.db
      .select({
        permission: space_permissions.permission,
      })
      .from(group_members)
      .innerJoin(
        space_permissions,
        and(
          eq(space_permissions.tenant_id, group_members.tenant_id),
          eq(space_permissions.group_id, group_members.group_id),
        ),
      )
      .where(
        and(
          eq(group_members.tenant_id, input.tenantId),
          eq(group_members.user_id, input.userId),
          eq(space_permissions.space_id, input.spaceId),
        ),
      );

    return [...new Set(rows.map((row) => row.permission))];
  }
}
