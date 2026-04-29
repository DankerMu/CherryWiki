import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { ValidationError } from 'class-validator';

import { getApiLogger } from '../logger/logger.module.js';
import { getRequestContext, getRequestIdFromRequest } from '../middleware/request-context.middleware.js';

export type ValidationErrorDetail = {
  property: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorDetail[];
};

type ErrorPayload = {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    details?: unknown[];
  };
};

type HttpResponseLike = {
  status: (statusCode: number) => {
    send: (body: ErrorPayload) => void;
  };
};

type HttpExceptionResponse = {
  message?: unknown;
  error?: unknown;
  details?: unknown;
};

const ERROR_CODE_BY_STATUS = new Map<number, ErrorCode>([
  [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR],
  [HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED],
  [HttpStatus.FORBIDDEN, ErrorCode.PERMISSION_DENIED],
  [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
  [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  [HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED],
  [HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR],
]);

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponseLike>();
    const request = http.getRequest<unknown>();
    const requestId = getRequestContext()?.request_id ?? getRequestIdFromRequest(request) ?? '';

    // Safety net for raw class-validator ValidationError objects thrown outside the ValidationPipe context.
    if (isValidationException(exception)) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).send({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Validation failed',
          request_id: requestId,
          details: validationErrorsToDetails(normalizeValidationErrors(exception)),
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = normalizeHttpExceptionResponse(exception.getResponse());
      const details = Array.isArray(exceptionResponse.details) ? exceptionResponse.details : undefined;

      response.status(status).send({
        error: {
          code: mapStatusToErrorCode(status),
          message: getHttpExceptionMessage(exception, exceptionResponse),
          request_id: requestId,
          ...(details === undefined ? {} : { details }),
        },
      });
      return;
    }

    getApiLogger().error(createExceptionLogObject(exception, requestId), 'Unhandled exception');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        request_id: requestId,
      },
    });
  }
}

export function validationErrorsToDetails(errors: ValidationError[], maxDepth = 5): ValidationErrorDetail[] {
  return validationErrorsToDetailsAtDepth(errors, maxDepth, 0);
}

function validationErrorsToDetailsAtDepth(
  errors: ValidationError[],
  maxDepth: number,
  currentDepth: number,
): ValidationErrorDetail[] {
  return errors.map((error) => {
    const detail: ValidationErrorDetail = {
      property: error.property,
    };

    if (error.constraints !== undefined && Object.keys(error.constraints).length > 0) {
      detail.constraints = error.constraints;
    }

    if (currentDepth < maxDepth && error.children !== undefined && error.children.length > 0) {
      detail.children = validationErrorsToDetailsAtDepth(error.children, maxDepth, currentDepth + 1);
    }

    return detail;
  });
}

function mapStatusToErrorCode(status: number): ErrorCode {
  return ERROR_CODE_BY_STATUS.get(status) ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR);
}

function getHttpExceptionMessage(exception: HttpException, response: HttpExceptionResponse): string {
  if (typeof response.message === 'string') {
    return response.message;
  }

  if (Array.isArray(response.message) && response.message.every((item) => typeof item === 'string')) {
    return response.message.join('; ');
  }

  if (typeof response.error === 'string') {
    return response.error;
  }

  return exception.message;
}

function normalizeHttpExceptionResponse(response: string | object): HttpExceptionResponse {
  if (typeof response === 'string') {
    return { message: response };
  }

  if (!isRecord(response)) {
    return {};
  }

  return {
    message: response.message,
    error: response.error,
    details: response.details,
  };
}

function normalizeValidationErrors(exception: ValidationError | ValidationError[]): ValidationError[] {
  return Array.isArray(exception) ? exception : [exception];
}

function isValidationException(exception: unknown): exception is ValidationError | ValidationError[] {
  if (exception instanceof ValidationError) {
    return true;
  }

  return Array.isArray(exception) && exception.every((item) => item instanceof ValidationError);
}

function createExceptionLogObject(exception: unknown, requestId: string): Record<string, unknown> {
  if (exception instanceof Error) {
    return {
      request_id: requestId,
      err: exception,
    };
  }

  return {
    request_id: requestId,
    exception,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
