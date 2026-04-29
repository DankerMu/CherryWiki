import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Put, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { ArrayMaxSize, ArrayUnique, IsArray, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { GroupService, type SpacePermissionGroupResponse } from '../groups/group.service.js';

class SpaceGroupPermissionDto {
  @IsString()
  @IsNotEmpty()
  group_id!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  permissions!: string[];
}

class ReplaceSpacePermissionsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((permission: SpaceGroupPermissionDto | undefined) => permission?.group_id)
  @ValidateNested({ each: true })
  @Type(() => SpaceGroupPermissionDto)
  permissions!: SpaceGroupPermissionDto[];
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
};

@Controller('spaces')
export class SpacePermissionController {
  constructor(private readonly groupService: GroupService) {}

  @Permissions('space:admin')
  @Get(':space_id/permissions')
  async listSpacePermissions(
    @Param('space_id') spaceId: string,
    @Req() request: RequestWithAuth,
  ): Promise<SpacePermissionGroupResponse[]> {
    const user = getAuthenticatedUser(request);
    return this.groupService.listSpacePermissions(spaceId, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }

  @Permissions('space:admin')
  @HttpCode(HttpStatus.OK)
  @Put(':space_id/permissions')
  async replaceSpacePermissions(
    @Param('space_id') spaceId: string,
    @Body() body: ReplaceSpacePermissionsDto,
    @Req() request: RequestWithAuth,
  ): Promise<SpacePermissionGroupResponse[]> {
    const user = getAuthenticatedUser(request);
    return this.groupService.replaceSpacePermissions(spaceId, body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }
}

function getAuthenticatedUser(request: RequestWithAuth): AuthenticatedRequestUser {
  if (request.user === undefined) {
    throw new HttpException(
      {
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Unauthenticated',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  return request.user;
}
