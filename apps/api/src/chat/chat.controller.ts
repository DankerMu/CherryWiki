import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import { ChatCompletionDto, ChatSessionsQueryDto, UpdateSessionSpacesDto } from './dto/chat.dto.js';
import { ChatService, type ChatAuditContext, type ChatStreamEvent } from './chat.service.js';

type RequestWithAuth = {
  user?: AuthenticatedRequestUser & {
    permissions?: string[];
    space_permissions?: Record<string, string[]>;
  };
  permissions?: string[];
  space_permissions?: Record<string, string[]>;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  id?: string;
};

type SseReply = {
  raw: {
    writeHead: (statusCode: number, headers: Record<string, string>) => void;
    write: (chunk: string) => void;
    end: () => void;
    on?: (event: 'close', listener: () => void) => void;
    off?: (event: 'close', listener: () => void) => void;
    removeListener?: (event: 'close', listener: () => void) => void;
    destroyed?: boolean;
    writableEnded?: boolean;
  };
};

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('chat/completions')
  @Permissions('chat:use')
  async streamCompletion(
    @Body() dto: ChatCompletionDto,
    @Req() request: RequestWithAuth,
    @Res() reply: SseReply,
  ): Promise<void> {
    const user = getAuthenticatedUser(request);
    const actorPermissions = request.permissions ?? user.permissions;
    const candidateSpacePermissions = request.space_permissions ?? user.space_permissions;
    const spacePermissions = isSpacePermissionMap(candidateSpacePermissions) ? candidateSpacePermissions : undefined;
    const events = await this.chatService.streamCompletion({
      tenantId: user.tenant_id,
      userId: user.sub,
      userGroupIds: user.group_ids,
      actorRole: user.role,
      message: dto.message,
      enableDeepAnalysis: dto.enable_deep_analysis === true,
      enableDatabase: dto.enable_database === true,
      auditContext: buildAuditContext(request),
      ...(actorPermissions !== undefined ? { actorPermissions } : {}),
      ...(spacePermissions !== undefined ? { spacePermissions } : {}),
      ...(dto.space_id !== undefined ? { spaceId: dto.space_id } : {}),
      ...(dto.space_ids !== undefined ? { spaceIds: dto.space_ids } : {}),
      ...(dto.retrieval_mode !== undefined ? { retrievalMode: dto.retrieval_mode } : {}),
      ...(dto.session_id !== undefined ? { sessionId: dto.session_id } : {}),
    });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let lastWriteAt = Date.now();
    const keepalive = setInterval(() => {
      if (!isReplyWritable(reply) || Date.now() - lastWriteAt < 15_000) {
        return;
      }

      reply.raw.write(': keepalive\n\n');
      lastWriteAt = Date.now();
    }, 15_000);

    const iterator = events[Symbol.asyncIterator]();
    let closeConnection: (() => void) | undefined;
    const closePromise = new Promise<'close'>((resolve) => {
      closeConnection = () => resolve('close');
    });

    if (closeConnection !== undefined) {
      reply.raw.on?.('close', closeConnection);
    }

    try {
      while (true) {
        const next = await Promise.race([
          iterator.next().then((result) => ({ type: 'event' as const, result })),
          closePromise.then((type) => ({ type })),
        ]);

        if (next.type === 'close' || !isReplyWritable(reply)) {
          await iterator.return?.();
          break;
        }

        if (next.result.done === true) {
          break;
        }

        const event = next.result.value;
        writeSseEvent(reply, event);
        lastWriteAt = Date.now();
      }
    } catch {
      if (isReplyWritable(reply)) {
        writeSseEvent(reply, {
          type: 'error',
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Chat completion failed',
        });
      }
    } finally {
      clearInterval(keepalive);
      if (closeConnection !== undefined) {
        reply.raw.off?.('close', closeConnection);
        reply.raw.removeListener?.('close', closeConnection);
      }
      if (isReplyWritable(reply)) {
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      }
    }
  }

  @Get('spaces/:spaceId/chat/sessions')
  @Permissions('chat:use')
  async listSessions(
    @Param('spaceId') spaceId: string,
    @Query() query: ChatSessionsQueryDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<ChatService['listSessions']> {
    const user = getAuthenticatedUser(request);
    return this.chatService.listSessions(
      user.tenant_id,
      spaceId,
      user.sub,
      query.page,
      query.limit,
      buildSessionPermissionContext(request, user),
    );
  }

  @Get('spaces/:spaceId/chat/sessions/:sessionId')
  @Permissions('chat:use')
  async getSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<ChatService['getSession']> {
    const user = getAuthenticatedUser(request);
    return this.chatService.getSession(
      user.tenant_id,
      sessionId,
      user.sub,
      spaceId,
      buildSessionPermissionContext(request, user),
    );
  }

  @Patch('spaces/:spaceId/chat/sessions/:sessionId')
  @Permissions('chat:use')
  async updateSessionSpaces(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateSessionSpacesDto,
    @Req() request: RequestWithAuth,
  ): ReturnType<ChatService['updateSessionSpaces']> {
    const user = getAuthenticatedUser(request);
    const candidateSpacePermissions = request.space_permissions ?? user.space_permissions;
    const spacePermissions = isSpacePermissionMap(candidateSpacePermissions) ? candidateSpacePermissions : undefined;
    return this.chatService.updateSessionSpaces(
      user.tenant_id,
      sessionId,
      user.sub,
      spaceId,
      dto.space_ids,
      spacePermissions,
      user.group_ids,
      user.role,
    );
  }

  @Delete('spaces/:spaceId/chat/sessions/:sessionId')
  @Permissions('chat:use')
  async deleteSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<ChatService['deleteSession']> {
    const user = getAuthenticatedUser(request);
    return this.chatService.deleteSession(
      user.tenant_id,
      sessionId,
      user.sub,
      spaceId,
      buildSessionPermissionContext(request, user),
    );
  }
}

function writeSseEvent(reply: SseReply, event: ChatStreamEvent): void {
  if (event.type === 'session') {
    reply.raw.write(`event: session\ndata: ${JSON.stringify({ session_id: event.session_id })}\n\n`);
    return;
  }

  if (event.type === 'content') {
    reply.raw.write(`event: content\ndata: ${JSON.stringify({ delta: event.delta })}\n\n`);
    return;
  }

  if (event.type === 'citations') {
    reply.raw.write(`event: citations\ndata: ${JSON.stringify({ citations: event.citations })}\n\n`);
    return;
  }

  if (event.type === 'usage') {
    reply.raw.write(`event: usage\ndata: ${JSON.stringify(event.usage)}\n\n`);
    return;
  }

  if (event.type === 'agent.tool_use') {
    reply.raw.write(`event: agent.tool_use\ndata: ${JSON.stringify({ id: event.id, name: event.name, input: event.input })}\n\n`);
    return;
  }

  if (event.type === 'chart.data') {
    reply.raw.write(`event: chart.data\ndata: ${JSON.stringify(event.data)}\n\n`);
    return;
  }

  if (event.type === 'message.completed') {
    const data = event.database_mode === undefined ? {} : { database_mode: event.database_mode };
    reply.raw.write(`event: message.completed\ndata: ${JSON.stringify(data)}\n\n`);
    return;
  }

  reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: event.code, message: event.message })}\n\n`);
}

function isReplyWritable(reply: SseReply): boolean {
  return reply.raw.destroyed !== true && reply.raw.writableEnded !== true;
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

function buildAuditContext(request: RequestWithAuth): ChatAuditContext {
  const userAgent = request.headers?.['user-agent'];
  const requestId = request.headers?.['x-request-id'];

  return {
    ...(request.ip !== undefined ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
    ...(typeof requestId === 'string' ? { requestId } : {}),
    ...(request.id !== undefined ? { requestId: request.id } : {}),
  };
}

function buildSessionPermissionContext(
  request: RequestWithAuth,
  user: AuthenticatedRequestUser & { permissions?: string[] },
): {
  userGroupIds: string[];
  actorRole?: string;
  actorPermissions?: string[];
  spacePermissions?: Record<string, string[]>;
} {
  const actorPermissions = request.permissions ?? user.permissions;
  const candidateSpacePermissions = request.space_permissions ?? user.space_permissions;
  const spacePermissions = isSpacePermissionMap(candidateSpacePermissions) ? candidateSpacePermissions : undefined;

  return {
    userGroupIds: user.group_ids,
    ...(user.role !== undefined ? { actorRole: user.role } : {}),
    ...(actorPermissions !== undefined ? { actorPermissions } : {}),
    ...(spacePermissions !== undefined ? { spacePermissions } : {}),
  };
}

function isSpacePermissionMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((permissions) =>
      Array.isArray(permissions) && permissions.every((permission) => typeof permission === 'string'),
    )
  );
}
