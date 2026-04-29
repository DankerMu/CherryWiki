import 'reflect-metadata';

import { HttpStatus, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { fileURLToPath } from 'node:url';

import { AppModule } from './app.module.js';
import { HttpExceptionFilter, validationErrorsToDetails } from './common/filters/http-exception.filter.js';
import { ResponseWrapperInterceptor } from './common/interceptors/response-wrapper.interceptor.js';
import { createNestLogger } from './common/logger/logger.module.js';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    exceptionFactory: (errors) =>
      new UnprocessableEntityException({
        message: 'Validation failed',
        details: validationErrorsToDetails(errors),
      }),
  });
}

export function configureApp(app: NestFastifyApplication): void {
  app.useLogger(createNestLogger());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseWrapperInterceptor());
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 8080;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 1_048_576 }),
    {
      bufferLogs: true,
    },
  );
  configureApp(app);
  await app.listen(parsePort(process.env.PORT), process.env.HOST ?? '0.0.0.0');
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isEntrypoint()) {
  await bootstrap();
}
