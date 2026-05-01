import { ErrorCode } from '@cherrygraph/shared';

export type SecurityValidationDetails = Record<string, unknown>;

export type SecurityValidationPass = {
  pass: true;
  details?: SecurityValidationDetails;
};

export type SecurityValidationReject = {
  pass: false;
  code: ErrorCode;
  reason: string;
  details: SecurityValidationDetails;
};

export type SecurityValidationResult = SecurityValidationPass | SecurityValidationReject;

export function validationPass(details?: SecurityValidationDetails): SecurityValidationPass {
  return details === undefined ? { pass: true } : { pass: true, details };
}

export function validationReject(
  code: ErrorCode,
  reason: string,
  details: SecurityValidationDetails = {},
): SecurityValidationReject {
  return {
    pass: false,
    code,
    reason,
    details,
  };
}
