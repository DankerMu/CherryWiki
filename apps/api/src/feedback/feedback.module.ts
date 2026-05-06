import { Injectable, MiddlewareConsumer, Module, RequestMethod, type NestMiddleware, type NestModule } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';

import { AuditModule } from '../audit/audit.module.js';
import { AuditService } from '../audit/audit.service.js';
import { FeedbackAdminController, FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

type FeedbackDeniedRequest = {
  method?: string;
  params?: Record<string, string | undefined>;
  user?: AuthenticatedRequestUser;
  url?: string;
  originalUrl?: string;
  headers?: IncomingHttpHeaders;
  raw?: {
    url?: string;
    headers?: IncomingHttpHeaders;
    request_id?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
  request_id?: string;
  id?: string;
};

type FeedbackDeniedResponse = {
  statusCode?: number;
  raw?: ServerResponse;
  on?: ServerResponse['on'];
  once?: ServerResponse['once'];
};

@Injectable()
class FeedbackDeniedAuditMiddleware implements NestMiddleware {
  constructor(private readonly auditService: AuditService) {}

  use(request: FeedbackDeniedRequest, response: FeedbackDeniedResponse, next: () => void): void {
    const rawResponse = response.raw ?? (response as ServerResponse);
    rawResponse.once('finish', () => {
      if (getResponseStatus(response) !== 403 || !isFeedbackSubmitRequest(request) || request.user === undefined) {
        return;
      }

      const spaceId = readSpaceId(request);
      const ip = getIp(request);
      const userAgent = getUserAgent(request);
      const requestId = getRequestId(request);
      this.auditService.push({
        tenant_id: request.user.tenant_id,
        actor_user_id: request.user.sub,
        action: 'feedback.denied',
        resource_type: 'feedback_item',
        ...(spaceId !== undefined ? { space_id: spaceId } : {}),
        ...(ip !== undefined ? { ip } : {}),
        ...(userAgent !== undefined ? { user_agent: userAgent } : {}),
        ...(requestId !== undefined ? { request_id: requestId } : {}),
        metadata_json: {
          reason: 'permission_denied',
        },
      });
    });

    next();
  }
}

@Module({
  imports: [AuditModule],
  controllers: [FeedbackController, FeedbackAdminController],
  providers: [FeedbackService, FeedbackDeniedAuditMiddleware],
  exports: [FeedbackService],
})
export class FeedbackModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(FeedbackDeniedAuditMiddleware)
      .forRoutes({ path: 'spaces/:spaceId/feedback', method: RequestMethod.POST });
  }
}

function getResponseStatus(response: FeedbackDeniedResponse): number | undefined {
  return response.raw?.statusCode ?? response.statusCode;
}

function isFeedbackSubmitRequest(request: FeedbackDeniedRequest): boolean {
  return request.method?.toUpperCase() === 'POST';
}

function readSpaceId(request: FeedbackDeniedRequest): string | undefined {
  const paramSpaceId = request.params?.spaceId ?? request.params?.space_id;
  if (paramSpaceId !== undefined && paramSpaceId.trim().length > 0) {
    return paramSpaceId;
  }

  const url = request.url ?? request.originalUrl ?? request.raw?.url ?? '';
  const match = /\/spaces\/([^/?#]+)\/feedback(?:[/?#]|$)/.exec(url);
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
}

function getIp(request: FeedbackDeniedRequest): string | undefined {
  return request.ip ?? request.socket?.remoteAddress ?? request.raw?.socket?.remoteAddress;
}

function getUserAgent(request: FeedbackDeniedRequest): string | undefined {
  const value = request.headers?.['user-agent'] ?? request.raw?.headers?.['user-agent'];
  if (typeof value === 'string') {
    return value;
  }

  return Array.isArray(value) ? value[0] : undefined;
}

function getRequestId(request: FeedbackDeniedRequest): string | undefined {
  const value = request.headers?.['x-request-id'] ?? request.raw?.headers?.['x-request-id'];
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return request.request_id ?? request.raw?.request_id ?? request.id;
}
