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
} from '@nestjs/common';
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

type MultipartField = {
  type: 'field';
  value: unknown;
};

type MultipartFile = {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype: string;
  file: AsyncIterable<Buffer | Uint8Array | string>;
  fields?: Record<string, MultipartField | MultipartFile | Array<MultipartField | MultipartFile> | undefined>;
};

type MultipartRequest = RequestWithAuth & {
  isMultipart?: () => boolean;
  file?: (options?: {
    throwFileSizeLimit?: boolean;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
      parts?: number;
    };
  }) => Promise<MultipartFile | undefined>;
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
  async createUpload(
    @Param('spaceId') spaceId: string,
    @Body() body: CreateUploadDto,
    @Req() request: MultipartRequest,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ): Promise<UploadResponseDto> {
    const user = getAuthenticatedUser(request);
    const context = buildUploadContext(request, user);
    const upload = await parseUploadRequest(request, body);
    const result =
      upload.file !== undefined
        ? await this.uploadsService.uploadFile({ spaceId, file: upload.file, metadata: upload.body }, context)
        : await this.uploadUrl(spaceId, upload.body, context);

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

async function parseUploadRequest(
  request: MultipartRequest,
  body: CreateUploadDto | undefined,
): Promise<{ file?: UploadedFileLike; body: CreateUploadDto }> {
  if (request.isMultipart?.() !== true) {
    return { body: body ?? {} };
  }

  if (typeof request.file !== 'function') {
    throw new HttpException(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Multipart upload support is not configured',
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  let part: MultipartFile | undefined;
  try {
    part = await request.file({
      throwFileSizeLimit: true,
      limits: {
        fileSize: UPLOAD_MAX_BYTES,
        files: 1,
        fields: 10,
        parts: 11,
      },
    });
  } catch (err) {
    if (isMultipartFileTooLargeError(err)) {
      throwFileTooLarge();
    }

    throw err;
  }

  if (part === undefined) {
    return { body: body ?? {} };
  }
  if (part.fieldname !== 'file') {
    throw new HttpException(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Multipart upload file field must be named file',
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  const buffer = await readMultipartBuffer(part.file, UPLOAD_MAX_BYTES);
  const file: UploadedFileLike = {
    originalname: part.filename,
    mimetype: part.mimetype,
    size: buffer.length,
    buffer,
  };

  return {
    file,
    body: {
      ...(body ?? {}),
      ...createUploadDtoFromMultipartFields(part.fields),
    },
  };
}

async function readMultipartBuffer(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throwFileTooLarge();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, size);
}

function createUploadDtoFromMultipartFields(
  fields: MultipartFile['fields'],
): CreateUploadDto {
  const dto = new CreateUploadDto();
  const sourceType = readMultipartStringField(fields, 'source_type');
  const url = readMultipartStringField(fields, 'url');
  const classification = readMultipartStringField(fields, 'classification');
  const tags = readMultipartStringField(fields, 'tags');
  const author = readMultipartStringField(fields, 'author');
  const processingStrategy = readMultipartStringField(fields, 'processing_strategy');

  if (sourceType !== undefined) {
    dto.source_type = sourceType as NonNullable<CreateUploadDto['source_type']>;
  }
  if (url !== undefined) {
    dto.url = url;
  }
  if (classification !== undefined) {
    dto.classification = classification;
  }
  if (tags !== undefined) {
    dto.tags = tags;
  }
  if (author !== undefined) {
    dto.author = author;
  }
  if (processingStrategy !== undefined) {
    dto.processing_strategy = processingStrategy as NonNullable<CreateUploadDto['processing_strategy']>;
  }

  return dto;
}

function readMultipartStringField(fields: MultipartFile['fields'], key: keyof CreateUploadDto): string | undefined {
  const field = fields?.[key];
  const value = Array.isArray(field) ? field[0] : field;
  if (value?.type !== 'field') {
    return undefined;
  }

  if (typeof value.value === 'string') {
    return value.value;
  }
  if (value.value === undefined || value.value === null) {
    return undefined;
  }

  return JSON.stringify(value.value);
}

function isMultipartFileTooLargeError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const record = err as Record<string, unknown>;
  return record.statusCode === 413 || record.code === 'FST_REQ_FILE_TOO_LARGE';
}

function throwFileTooLarge(): never {
  throw new HttpException(
    {
      code: ErrorCode.FILE_TOO_LARGE,
      message: 'File exceeds the 200MB upload limit',
    },
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
}
