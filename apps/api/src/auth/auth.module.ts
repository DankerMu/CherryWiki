import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AUTH_CORE_OPTIONS, JwtAuthGuard, RbacGuard } from '@cherrygraph/auth-core';

import { RateLimitGuard } from '../common/guards/rate-limit.guard.js';
import { AuthContextInterceptor } from './auth-context.interceptor.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    JwtAuthGuard,
    RbacGuard,
    RateLimitGuard,
    AuthContextInterceptor,
    {
      provide: AUTH_CORE_OPTIONS,
      useValue: {
        getJwtSecret,
      },
    },
    {
      provide: APP_GUARD,
      useExisting: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useExisting: RbacGuard,
    },
    {
      provide: APP_GUARD,
      useExisting: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useExisting: AuthContextInterceptor,
    },
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new Error('JWT_SECRET is required');
  }

  return secret;
}
