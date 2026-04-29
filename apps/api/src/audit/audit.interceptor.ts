import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { getApiLogger } from '../common/logger/logger.module.js';
import { requestContextStorage } from '../common/middleware/request-context.middleware.js';
import { AUDIT_METADATA_KEY } from './audit.decorator.js';
import { AuditService, type AuditEntry } from './audit.service.js';

type RequestLike = {
  headers?: IncomingHttpHeaders;
  ip?: string;
  raw?: {
    headers?: IncomingHttpHeaders;
    ip?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  socket?: {
    remoteAddress?: string;
  };
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = getAuditAction(context);
    if (action === undefined) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        this.pushAuditEntry(context, action);
      }),
    );
  }

  private pushAuditEntry(context: ExecutionContext, action: string): void {
    try {
      this.auditService.push(buildAuditEntry(context, action));
    } catch (err) {
      getApiLogger().warn({ err, action }, 'Audit interceptor failed to enqueue entry');
    }
  }
}

function getAuditAction(context: ExecutionContext): string | undefined {
  const handlerAction = Reflect.getMetadata(AUDIT_METADATA_KEY, context.getHandler()) as unknown;
  if (typeof handlerAction === 'string' && handlerAction.length > 0) {
    return handlerAction;
  }

  const classAction = Reflect.getMetadata(AUDIT_METADATA_KEY, context.getClass()) as unknown;
  return typeof classAction === 'string' && classAction.length > 0 ? classAction : undefined;
}

function buildAuditEntry(context: ExecutionContext, action: string): AuditEntry {
  const request = context.switchToHttp().getRequest<RequestLike>();
  const requestContext = requestContextStorage.getStore();
  const userId = requestContext?.user_id;
  const spaceId = requestContext?.space_id;
  const ip = getRequestIp(request);
  const userAgent = getUserAgent(request);

  return {
    tenant_id: requestContext?.tenant_id ?? '',
    action,
    resource_type: getResourceType(context.getClass()),
    ...(userId !== undefined && userId !== null && userId.length > 0 ? { actor_user_id: userId } : {}),
    ...(spaceId !== undefined && spaceId !== null && spaceId.length > 0 ? { space_id: spaceId } : {}),
    ...(requestContext?.request_id !== undefined ? { request_id: requestContext.request_id } : {}),
    ...(ip !== undefined ? { ip } : {}),
    ...(userAgent !== undefined ? { user_agent: userAgent } : {}),
  };
}

function getResourceType(controller: { name: string }): string {
  const controllerName = controller.name.replace(/Controller$/, '');
  if (controllerName.length === 0) {
    return 'unknown';
  }

  return controllerName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function getRequestIp(request: RequestLike): string | undefined {
  return request.ip ?? request.raw?.ip ?? request.socket?.remoteAddress ?? request.raw?.socket?.remoteAddress;
}

function getUserAgent(request: RequestLike): string | undefined {
  const headers = request.headers ?? request.raw?.headers;
  const value = headers?.['user-agent'];
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === 'string' ? firstValue : undefined;
  }

  return undefined;
}
