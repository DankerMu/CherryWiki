import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { requestContextStorage } from '../common/middleware/request-context.middleware.js';

type RequestWithUser = {
  user?: unknown;
};

@Injectable()
export class AuthContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const contextStore = requestContextStorage.getStore();

    if (contextStore !== undefined && isAuthenticatedUser(request.user)) {
      contextStore.tenant_id = request.user.tenant_id;
      contextStore.user_id = request.user.sub;
    }

    return next.handle();
  }
}

function isAuthenticatedUser(value: unknown): value is { sub: string; tenant_id: string } {
  if (!isRecord(value)) {
    return false;
  }

  return isNonEmptyString(value.sub) && isNonEmptyString(value.tenant_id);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}
