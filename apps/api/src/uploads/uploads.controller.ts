import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import { UPLOAD_MAX_BYTES } from './uploads.constants.js';
import { CreateUploadDto, UploadListQueryDto, type UploadedFileLike, type UploadResponseDto } from './uploads.dto.js';
import { UploadsService, type UploadContext } from './uploads.service.js';

type RequestWithAuth = {
  user?: AuthenticatedRequestUser & {
    permissions?: string[];
  };
  permissions?: string[];
};

type PassthroughResponse = {
  status?: (code: number) => unknown;
  code?: (code: number) => unknown;
};

@Controller()
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Permissions('upload:create')
  @Post('spaces/:spaceId/uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES } }))
  async createUpload(
    @Param('spaceId') spaceId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: CreateUploadDto,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ): Promise<UploadResponseDto> {
    const user = getAuthenticatedUser(request);
    const context = buildUploadContext(request, user);
    const result =
      file !== undefined
        ? await this.uploadsService.uploadFile({ spaceId, file, metadata: body }, context)
        : await this.uploadUrl(spaceId, body, context);

    setResponseStatus(response, result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Permissions('upload:read')
  @Get('uploads/:sourceDocumentId')
  async getUpload(
    @Param('sourceDocumentId') sourceDocumentId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<UploadsService['getUpload']> {
    const user = getAuthenticatedUser(request);
    return this.uploadsService.getUpload(sourceDocumentId, buildUploadContext(request, user));
  }

  @Permissions('upload:read')
  @Get('uploads/:sourceDocumentId/status')
  async getUploadStatus(
    @Param('sourceDocumentId') sourceDocumentId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<UploadsService['getUploadStatus']> {
    const user = getAuthenticatedUser(request);
    return this.uploadsService.getUploadStatus(sourceDocumentId, buildUploadContext(request, user));
  }

  @Permissions('upload:create')
  @HttpCode(HttpStatus.OK)
  @Post('uploads/:sourceDocumentId/reprocess')
  async reprocess(
    @Param('sourceDocumentId') sourceDocumentId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<UploadsService['reprocess']> {
    const user = getAuthenticatedUser(request);
    return this.uploadsService.reprocess(sourceDocumentId, buildUploadContext(request, user));
  }

  @Permissions('upload:read')
  @Get('spaces/:spaceId/uploads')
  async listUploads(
    @Param('spaceId') spaceId: string,
    @Query() query: UploadListQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<UploadsService['listUploads']> {
    const user = getAuthenticatedUser(request);
    return this.uploadsService.listUploads(spaceId, query, buildUploadContext(request, user));
  }

  private async uploadUrl(
    spaceId: string,
    body: CreateUploadDto,
    context: UploadContext,
  ): Promise<UploadResponseDto> {
    if (body.url === undefined || body.url.trim().length === 0) {
      throw new HttpException(
        {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Upload request must include either a file or url',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.uploadsService.uploadUrl({ spaceId, url: body.url, metadata: body }, context);
  }
}

function getAuthenticatedUser(request: RequestWithAuth): AuthenticatedRequestUser & { permissions?: string[] } {
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

function buildUploadContext(
  request: RequestWithAuth,
  user: AuthenticatedRequestUser & { permissions?: string[] },
): UploadContext {
  const actorPermissions = request.permissions ?? user.permissions;

  return {
    tenantId: user.tenant_id,
    actorUserId: user.sub,
    actorRole: user.role,
    userId: user.sub,
    ...(actorPermissions !== undefined ? { actorPermissions } : {}),
  };
}

function setResponseStatus(response: PassthroughResponse, status: HttpStatus): void {
  if (typeof response.status === 'function') {
    response.status(status);
    return;
  }

  response.code?.(status);
}
