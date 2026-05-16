import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import {
  ModelConfigService,
  type AdminModelConfigResponse,
  type ChatModelAvailabilityResponse,
  type ModelConnectivityTestResponse,
} from './model-config.service.js';

class CreateModelConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  provider!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model_id!: string;

  @IsIn(['chat', 'embedding', 'rerank'])
  model_type!: 'chat' | 'embedding' | 'rerank';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  base_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  encrypted_api_key_ref?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  embedding_dim?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_tokens?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rate_limit_rpm?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  visible_group_ids?: string[];
}

class UpdateModelConfigDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  provider?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model_id?: string;

  @IsOptional()
  @IsIn(['chat', 'embedding', 'rerank'])
  model_type?: 'chat' | 'embedding' | 'rerank';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  base_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  encrypted_api_key_ref?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  embedding_dim?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_tokens?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rate_limit_rpm?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  visible_group_ids?: string[];
}

class TestModelConnectivityDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  test_prompt?: string;
}

type RequestWithAuth = {
  user?: AuthenticatedRequestUser;
};

@Controller('models')
export class PublicModelConfigController {
  constructor(private readonly modelConfigService: ModelConfigService) {}

  @Get('chat-available')
  async isChatModelAvailable(@Req() request: RequestWithAuth): Promise<ChatModelAvailabilityResponse> {
    const user = getAuthenticatedUser(request);
    return this.modelConfigService.hasAvailableChatModel({
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }
}

@Permissions('admin:model_manage')
@Controller('admin/models')
export class ModelConfigController {
  constructor(private readonly modelConfigService: ModelConfigService) {}

  @Get()
  async listModels(
    @Query() query: PaginationQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<ModelConfigService['listModels']> {
    const user = getAuthenticatedUser(request);
    return this.modelConfigService.listModels(query, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }

  @Post()
  async createModel(
    @Body() body: CreateModelConfigDto,
    @Req() request: RequestWithAuth,
  ): Promise<AdminModelConfigResponse> {
    const user = getAuthenticatedUser(request);
    return this.modelConfigService.createModel(body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':model_id')
  async updateModel(
    @Param('model_id') modelId: string,
    @Body() body: UpdateModelConfigDto,
    @Req() request: RequestWithAuth,
  ): Promise<AdminModelConfigResponse> {
    const user = getAuthenticatedUser(request);
    return this.modelConfigService.updateModel(modelId, body, {
      tenantId: user.tenant_id,
      actorUserId: user.sub,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post(':model_id/test')
  async testConnectivity(
    @Param('model_id') modelId: string,
    @Body() body: TestModelConnectivityDto,
    @Req() request: RequestWithAuth,
  ): Promise<ModelConnectivityTestResponse> {
    const user = getAuthenticatedUser(request);
    return this.modelConfigService.testConnectivity(modelId, body, {
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
