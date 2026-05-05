import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Permissions, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';

import { ChatCompletionDto, ChatSessionsQueryDto } from './dto/chat.dto.js';
import { ChatService, type ChatAuditContext, type ChatStreamEvent } from './chat.service.js';

type RequestWithAuth = {
  user?: AuthenticatedRequestUser & {
    permissions?: string[];
  };
  permissions?: string[];
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  id?: string;
};

type SseReply = {
  raw: {
    writeHead: (statusCode: number, headers: Record<string, string>) => void;
    write: (chunk: string) => void;
    end: () => void;
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
    const events = await this.chatService.streamCompletion({
      tenantId: user.tenant_id,
      spaceId: dto.space_id,
      userId: user.sub,
      userGroupIds: user.group_ids,
      message: dto.message,
      enableDeepAnalysis: dto.enable_deep_analysis === true,
      enableDatabase: dto.enable_database === true,
      auditContext: buildAuditContext(request),
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

    try {
      for await (const event of events) {
        if (!isReplyWritable(reply)) {
          break;
        }

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
    return this.chatService.listSessions(user.tenant_id, spaceId, user.sub, query.page, query.limit);
  }

  @Get('spaces/:spaceId/chat/sessions/:sessionId')
  @Permissions('chat:use')
  async getSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<ChatService['getSession']> {
    const user = getAuthenticatedUser(request);
    return this.chatService.getSession(user.tenant_id, sessionId, user.sub, spaceId);
  }

  @Delete('spaces/:spaceId/chat/sessions/:sessionId')
  @Permissions('chat:use')
  async deleteSession(
    @Param('spaceId') spaceId: string,
    @Param('sessionId') sessionId: string,
    @Req() request: RequestWithAuth,
  ): ReturnType<ChatService['deleteSession']> {
    const user = getAuthenticatedUser(request);
    return this.chatService.deleteSession(user.tenant_id, sessionId, user.sub, spaceId);
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
    reply.raw.write(`event: message.completed\ndata: ${JSON.stringify({})}\n\n`);
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
