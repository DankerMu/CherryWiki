import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { SpaceService, type SpaceDetail, type SpaceStatsResponse } from './space.service.js';

class ListSpacesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

class CreateSpaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

class DatabaseConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  dsn?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  allowed_tables?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  masked_columns?: string[];
}

class UpdateSpaceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  strict_knowledge_only?: boolean;

  @IsOptional()
  @IsObject()
  graphify_config?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => DatabaseConfigDto)
  database_config?: DatabaseConfigDto;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  wiki_repo_path?: string;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
};

@Controller('spaces')
export class SpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  @Get()
  async listSpaces(
    @Query() query: ListSpacesQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<SpaceService['listSpaces']> {
    const user = getAuthenticatedUser(request);
    return this.spaceService.listSpaces(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
      userId: user.sub,
    });
  }

  @Permissions('admin:user_manage')
  @Post()
  async createSpace(
    @Body() body: CreateSpaceDto,
    @Req() request: RequestWithAuth,
  ): Promise<SpaceDetail> {
    const user = getAuthenticatedUser(request);
    return this.spaceService.createSpace(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
    });
  }

  @Permissions('space:view')
  @Get(':space_id/stats')
  async getStats(
    @Param('space_id') spaceId: string,
    @Req() request: RequestWithAuth,
  ): Promise<SpaceStatsResponse> {
    const user = getAuthenticatedUser(request);
    return this.spaceService.getStats(spaceId, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
      userId: user.sub,
    });
  }

  @Get(':space_id')
  async getSpace(
    @Param('space_id') spaceId: string,
    @Req() request: RequestWithAuth,
  ): Promise<SpaceDetail> {
    const user = getAuthenticatedUser(request);
    return this.spaceService.getSpace(spaceId, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
      userId: user.sub,
    });
  }

  @Permissions('space:admin')
  @HttpCode(HttpStatus.OK)
  @Patch(':space_id')
  async updateSpace(
    @Param('space_id') spaceId: string,
    @Body() body: UpdateSpaceDto,
    @Req() request: RequestWithAuth,
  ): Promise<SpaceDetail> {
    const user = getAuthenticatedUser(request);
    return this.spaceService.updateSpace(spaceId, body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
      userId: user.sub,
    });
  }

  @Permissions('admin:user_manage')
  @Delete(':space_id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveSpace(
    @Param('space_id') spaceId: string,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    const user = getAuthenticatedUser(request);
    await this.spaceService.archiveSpace(spaceId, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
      actorRole: user.role,
      userId: user.sub,
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
