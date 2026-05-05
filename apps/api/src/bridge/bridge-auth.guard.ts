import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import * as crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { AuditService } from '../audit/audit.service.js';
import { getApiLogger } from '../common/logger/logger.module.js';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';

const BRIDGE_TIMESTAMP_WINDOW_SECONDS = 5 * 60;
const BRIDGE_NONCE_TTL_SECONDS = 10 * 60;

type BridgeNonceRedisStore = {
  set: (key: string, value: string, mode: 'EX', ttl: number, condition: 'NX') => Promise<'OK' | null>;
};

type RequestLike = {
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  raw?: {
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
    method?: string;
    url?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  method?: string;
  url?: string;
  originalUrl?: string;
  body?: unknown;
  rawBody?: string | Buffer;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

@Injectable()
export class BridgeAuthGuard implements CanActivate {
  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: BridgeNonceRedisStore,
    @Optional() private readonly auditService?: AuditService,
  ) {
    if (getBridgeSecrets().length === 0) {
      getApiLogger().warn(
        { docmost_bridge_secret_present: false },
        'DOCMOST_BRIDGE_SECRET is not configured; Docmost Bridge receiver endpoints will reject requests',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const secrets = getBridgeSecrets();
    if (secrets.length === 0) {
      throwBridgeAuthError(ErrorCode.BRIDGE_AUTH_MISSING, 'Bridge authentication is not configured');
    }

    const authorization = getHeaderValue(request, 'authorization');
    if (!hasMatchingBearerToken(secrets, authorization)) {
      throwBridgeAuthError(ErrorCode.BRIDGE_AUTH_MISSING, 'Missing or invalid Bridge bearer token');
    }

    const timestamp = getHeaderValue(request, 'x-bridge-timestamp');
    const nonce = getHeaderValue(request, 'x-bridge-nonce');
    const signature = getHeaderValue(request, 'x-bridge-signature');
    if (timestamp === undefined || nonce === undefined || signature === undefined) {
      throwBridgeAuthError(ErrorCode.BRIDGE_AUTH_MISSING, 'Missing Bridge authentication headers');
    }

    if (!isFreshTimestamp(timestamp)) {
      throwBridgeAuthError(ErrorCode.BRIDGE_TIMESTAMP_EXPIRED, 'Bridge timestamp is outside the allowed window');
    }

    if (!hasValidSignature(secrets, signature, createSignaturePayload(request, timestamp, nonce))) {
      this.audit('bridge.hmac_rejected', request, {
        reason: 'signature_mismatch',
        path: getRequestPath(request),
      });
      throwBridgeAuthError(ErrorCode.BRIDGE_HMAC_INVALID, 'Invalid Bridge HMAC signature');
    }

    if (!(await this.storeNonce(nonce))) {
      this.audit('bridge.nonce_reused', request, { nonce });
      throwBridgeAuthError(ErrorCode.BRIDGE_NONCE_REUSED, 'Bridge nonce was already used');
    }

    return true;
  }

  private async storeNonce(nonce: string): Promise<boolean> {
    if (this.redis === undefined) {
      getApiLogger().warn({ redis_configured: false }, 'Bridge nonce validation failed because Redis is not configured');
      throwBridgeAuthError(ErrorCode.BRIDGE_AUTH_MISSING, 'Bridge nonce store is not configured');
    }

    const result = await this.redis.set(`bridge:nonce:${nonce}`, '1', 'EX', BRIDGE_NONCE_TTL_SECONDS, 'NX');
    return result === 'OK';
  }

  private audit(action: string, request: RequestLike, metadata: Record<string, unknown>): void {
    const userAgent = getHeaderValue(request, 'user-agent');

    this.auditService?.push({
      tenant_id: '',
      action,
      resource_type: 'bridge',
      ip: getIpAddress(request),
      ...(userAgent !== undefined ? { user_agent: userAgent } : {}),
      metadata_json: {
        source_ip: getIpAddress(request),
        ...metadata,
      },
    });
  }
}

function getBridgeSecrets(): string[] {
  return [process.env.DOCMOST_BRIDGE_SECRET, process.env.DOCMOST_BRIDGE_SECRET_NEXT].filter(
    (secret): secret is string => typeof secret === 'string' && secret.length > 0,
  );
}

function throwBridgeAuthError(code: ErrorCode, message: string): never {
  throw new HttpException({ code, message }, HttpStatus.UNAUTHORIZED);
}

function getHeaderValue(request: RequestLike, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  const directValue = normalizeHeaderValue(request.headers?.[normalizedName]);
  if (directValue !== undefined) {
    return directValue;
  }

  return normalizeHeaderValue(request.raw?.headers?.[normalizedName]);
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return first?.trim();
  }

  return undefined;
}

function hasMatchingBearerToken(secrets: string[], authorization: string | undefined): boolean {
  const token = parseBearerToken(authorization);
  return token !== undefined && secrets.some((secret) => timingSafeStringEqual(secret, token));
}

function parseBearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return undefined;
  }

  return token;
}

function isFreshTimestamp(timestamp: string): boolean {
  const parsed = Number(timestamp);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - parsed) <= BRIDGE_TIMESTAMP_WINDOW_SECONDS;
}

function createSignaturePayload(request: RequestLike, timestamp: string, nonce: string): string {
  const method = (request.method ?? request.raw?.method ?? '').toUpperCase();
  const path = getRequestPath(request);
  const bodyHash = crypto.createHash('sha256').update(getSignatureBody(request)).digest('hex');

  return `${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}`;
}

function getRequestPath(request: RequestLike): string {
  const url = request.originalUrl ?? request.raw?.url ?? request.url ?? '';
  return url.split('?')[0] ?? '';
}

function getSignatureBody(request: RequestLike): string | Buffer {
  if (typeof request.rawBody === 'string' || Buffer.isBuffer(request.rawBody)) {
    return request.rawBody;
  }

  if (request.body === undefined || request.body === null) {
    return '';
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  return JSON.stringify(request.body);
}

function hasValidSignature(secrets: string[], signature: string, payload: string): boolean {
  const providedSignature = parseSignature(signature);
  if (providedSignature === undefined) {
    return false;
  }

  return secrets.some((secret) => {
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return timingSafeHexEqual(expectedSignature, providedSignature);
  });
}

function parseSignature(signature: string): string | undefined {
  const normalized = signature.trim().toLowerCase();
  const match = /^sha256=([a-f0-9]{64})$/.exec(normalized);
  return match?.[1];
}

function timingSafeStringEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  const normalizedActualBuffer =
    actualBuffer.length === expectedBuffer.length ? actualBuffer : Buffer.alloc(expectedBuffer.length);
  const matches = crypto.timingSafeEqual(expectedBuffer, normalizedActualBuffer);

  return actualBuffer.length === expectedBuffer.length && matches;
}

function timingSafeHexEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function getIpAddress(request: RequestLike): string {
  return request.ip || request.raw?.socket?.remoteAddress || request.socket?.remoteAddress || 'unknown';
}
