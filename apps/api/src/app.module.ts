import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';

import { PinoHttpLoggerMiddleware, LoggerModule } from './common/logger/logger.module.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [LoggerModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, PinoHttpLoggerMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
