import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { GroupService, type AdminGroupResponse } from './group.service.js';

class SpacePermissionDto {
  @IsString()
  @IsNotEmpty()
  space_id!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  permissions!: string[];
}

class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  member_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((permission: SpacePermissionDto | undefined) => permission?.space_id)
  @ValidateNested({ each: true })
  @Type(() => SpacePermissionDto)
  space_permissions?: SpacePermissionDto[];
}

class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  member_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((permission: SpacePermissionDto | undefined) => permission?.space_id)
  @ValidateNested({ each: true })
  @Type(() => SpacePermissionDto)
  space_permissions?: SpacePermissionDto[];
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
};

@Permissions('admin:user_manage')
@Controller('admin/groups')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Get()
  async listGroups(
    @Query() query: PaginationQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<GroupService['listGroups']> {
    const user = getAuthenticatedUser(request);
    return this.groupService.listGroups(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }

  @Post()
  async createGroup(
    @Body() body: CreateGroupDto,
    @Req() request: RequestWithAuth,
  ): Promise<AdminGroupResponse> {
    const user = getAuthenticatedUser(request);
    return this.groupService.createGroup(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Put(':group_id')
  async updateGroup(
    @Param('group_id') groupId: string,
    @Body() body: UpdateGroupDto,
    @Req() request: RequestWithAuth,
  ): Promise<AdminGroupResponse> {
    const user = getAuthenticatedUser(request);
    return this.groupService.updateGroup(groupId, body, {
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
