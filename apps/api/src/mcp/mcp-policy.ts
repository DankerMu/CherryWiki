export type McpAuthorizationParams = {
  tokenScopes: readonly string[];
  tokenRole: string;
  spaceId: string;
  policy: unknown;
};

export type McpAuthorizationResult = {
  authorized: boolean;
  denial_reason?: string;
};

type JsonRecord = Record<string, unknown>;

export function checkMcpAuthorization(params: McpAuthorizationParams): McpAuthorizationResult {
  if (!params.tokenScopes.includes('mcp:invoke')) {
    return deny('missing_mcp_invoke_scope');
  }

  const policy = normalizePolicy(params.policy);

  if (policy.allowed_scopes.length > 0 && !hasIntersection(params.tokenScopes, policy.allowed_scopes)) {
    return deny('tool_scope_denied');
  }

  if (policy.allowed_roles.length > 0 && !policy.allowed_roles.includes(params.tokenRole)) {
    return deny('role_denied');
  }

  if (policy.allowed_spaces.length > 0 && !policy.allowed_spaces.includes(params.spaceId)) {
    return deny('space_denied');
  }

  return { authorized: true };
}

export function normalizeMcpPolicy(policy: unknown): {
  allowed_roles: string[];
  allowed_spaces: string[];
  allowed_scopes: string[];
  rate_limit_rpm?: number;
} {
  const record = isRecord(policy) ? policy : {};
  const rateLimit = record.rate_limit_rpm;

  return {
    allowed_roles: readStringArray(record.allowed_roles),
    allowed_spaces: readStringArray(record.allowed_spaces),
    allowed_scopes: readStringArray(record.allowed_scopes),
    ...(typeof rateLimit === 'number' && Number.isInteger(rateLimit) && rateLimit >= 0
      ? { rate_limit_rpm: rateLimit }
      : {}),
  };
}

function normalizePolicy(policy: unknown): {
  allowed_roles: string[];
  allowed_spaces: string[];
  allowed_scopes: string[];
} {
  const normalized = normalizeMcpPolicy(policy);
  return {
    allowed_roles: normalized.allowed_roles,
    allowed_spaces: normalized.allowed_spaces,
    allowed_scopes: normalized.allowed_scopes,
  };
}

function deny(denial_reason: string): McpAuthorizationResult {
  return {
    authorized: false,
    denial_reason,
  };
}

function hasIntersection(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  return right.some((value) => leftSet.has(value));
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
