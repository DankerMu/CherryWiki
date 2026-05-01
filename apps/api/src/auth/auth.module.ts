import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import {
  AUTH_CORE_OPTIONS,
  JwtAuthGuard,
  RbacGuard,
  SPACE_PERMISSION_RESOLVER,
  type AuthCoreOptions,
  type SpacePermissionResolver,
} from '@cherrygraph/auth-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { RateLimitGuard } from '../common/guards/rate-limit.guard.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { DrizzleSpacePermissionResolver } from '../groups/space-permission.resolver.js';
import { AuthContextInterceptor } from './auth-context.interceptor.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    {
      provide: JwtAuthGuard,
      useFactory: (options?: AuthCoreOptions): JwtAuthGuard => new JwtAuthGuard(new Reflector(), options),
      inject: [{ token: AUTH_CORE_OPTIONS, optional: true }],
    },
    {
      provide: RbacGuard,
      useFactory: (resolver?: SpacePermissionResolver): RbacGuard => new RbacGuard(new Reflector(), resolver),
      inject: [{ token: SPACE_PERMISSION_RESOLVER, optional: true }],
    },
    Reflector,
    RateLimitGuard,
    AuthContextInterceptor,
    {
      provide: SPACE_PERMISSION_RESOLVER,
      useFactory: (db?: NodePgDatabase): SpacePermissionResolver | undefined =>
        db === undefined ? undefined : new DrizzleSpacePermissionResolver(db),
      inject: [{ token: DRIZZLE, optional: true }],
    },
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
