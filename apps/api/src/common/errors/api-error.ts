import { HttpException, type HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';

export type ApiErrorDetails = unknown[];

export function throwApiError(
  code: ErrorCode,
  message: string,
  status: HttpStatus,
  details?: ApiErrorDetails,
): never {
  throw new HttpException(
    {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    status,
  );
}
