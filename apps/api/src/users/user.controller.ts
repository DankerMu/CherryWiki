import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { UserService, type AdminUserResponse } from './user.service.js';

class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  role!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  groups?: string[];
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  display_name?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsIn(['active', 'disabled', 'deleted'])
  status?: string;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
};

@Permissions('admin:user_manage')
@Controller('admin/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async listUsers(
    @Query() query: ListUsersQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<UserService['listUsers']> {
    const user = getAuthenticatedUser(request);
    return this.userService.listUsers(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }

  @Post()
  async createUser(
    @Body() body: CreateUserDto,
    @Req() request: RequestWithAuth,
  ): Promise<AdminUserResponse> {
    const user = getAuthenticatedUser(request);
    return this.userService.createUser(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':user_id')
  async updateUser(
    @Param('user_id') userId: string,
    @Body() body: UpdateUserDto,
    @Req() request: RequestWithAuth,
  ): Promise<AdminUserResponse> {
    const user = getAuthenticatedUser(request);
    return this.userService.updateUser(userId, body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
    });
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':user_id')
  async deleteUser(
    @Param('user_id') userId: string,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    const user = getAuthenticatedUser(request);
    await this.userService.deleteUser(userId, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
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
