import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { getApiLogger } from '../common/logger/logger.module.js';
import { UserService } from '../users/user.service.js';

const DOCMOST_BOOTSTRAP_FETCH_TIMEOUT_MS = 10_000;

type BridgeHealthResponse = {
  workspace_initialized?: unknown;
  workspace_count?: unknown;
};

type BootstrapPayload = {
  workspaceName: string;
  name: string;
  email: string;
  password: string;
};

type BootstrapConfig = {
  baseUrl: string;
  secret: string;
  adminEmail: string;
  adminPassword: string;
};

type ConfigResolution =
  | { status: 'ready'; config: BootstrapConfig }
  | { status: 'disabled' }
  | { status: 'pending' };

@Injectable()
export class DocmostBootstrapService {
  constructor(private readonly userService?: UserService) {}

  async bootstrapIfNeeded(): Promise<boolean> {
    const configResolution = await this.getConfig();
    if (configResolution.status === 'disabled') {
      return true;
    }

    if (configResolution.status === 'pending') {
      return false;
    }

    const config = configResolution.config;
    try {
      const healthPath = '/api/internal/bridge/health';
      const healthResponse = await fetchWithTimeout(`${config.baseUrl}${healthPath}`, {
        method: 'GET',
        headers: createBridgeHeaders({
          secret: config.secret,
          method: 'GET',
          path: healthPath,
          body: '',
        }),
      });

      if (!healthResponse.ok) {
        await healthResponse.body?.cancel().catch(() => undefined);
        getApiLogger().warn(
          { status: healthResponse.status },
          'Docmost workspace bootstrap health check failed',
        );
        return false;
      }

      const health = readHealthResponse(await healthResponse.json());
      if (isWorkspaceInitialized(health)) {
        return true;
      }

      const payload: BootstrapPayload = {
        workspaceName: process.env.CHERRY_TENANT_NAME?.trim() || 'CherryWiki',
        name: 'Admin',
        email: config.adminEmail,
        password: config.adminPassword,
      };
      const body = JSON.stringify(payload);
      const bootstrapPath = '/api/internal/bridge/bootstrap';
      const bootstrapResponse = await fetchWithTimeout(`${config.baseUrl}${bootstrapPath}`, {
        method: 'POST',
        headers: {
          ...createBridgeHeaders({
            secret: config.secret,
            method: 'POST',
            path: bootstrapPath,
            body,
          }),
          'content-type': 'application/json',
        },
        body,
      });

      if (bootstrapResponse.ok) {
        getApiLogger().info(
          { workspace_name: payload.workspaceName },
          'Docmost workspace bootstrap completed',
        );
        return true;
      }

      await bootstrapResponse.body?.cancel().catch(() => undefined);
      if (bootstrapResponse.status === 409) {
        getApiLogger().info('Docmost workspace already initialized');
        return true;
      }

      getApiLogger().warn(
        { status: bootstrapResponse.status },
        'Docmost workspace bootstrap failed',
      );
      return false;
    } catch (err) {
      getApiLogger().warn(
        { err: toSafeErrorMessage(err) },
        'Docmost workspace bootstrap skipped',
      );
      return false;
    }
  }

  private async getConfig(): Promise<ConfigResolution> {
    const baseUrl = process.env.DOCMOST_BASE_URL?.trim().replace(/\/+$/, '');
    const secret = process.env.DOCMOST_BRIDGE_SECRET?.trim();
    const adminEmail = process.env.DOCMOST_ADMIN_EMAIL?.trim();
    const adminPassword =
      process.env.DOCMOST_ADMIN_PASSWORD?.trim() || generateBootstrapPassword();

    if (!baseUrl || !secret) {
      getApiLogger().warn(
        {
          docmost_base_url_present: Boolean(baseUrl),
          docmost_bridge_secret_present: Boolean(secret),
        },
        'Docmost workspace bootstrap is not configured',
      );
      return { status: 'disabled' };
    }

    const resolvedAdminEmail = adminEmail || (await this.getFirstAdminEmail());
    if (!resolvedAdminEmail) {
      getApiLogger().warn(
        {
          docmost_admin_email_present: Boolean(adminEmail),
          cherry_admin_user_present: false,
        },
        'Docmost workspace bootstrap is waiting for a Cherry admin user',
      );
      return { status: 'pending' };
    }

    return {
      status: 'ready',
      config: { baseUrl, secret, adminEmail: resolvedAdminEmail, adminPassword },
    };
  }

  private async getFirstAdminEmail(): Promise<string | undefined> {
    try {
      return (await this.userService?.findFirstAdminUser())?.email;
    } catch (err) {
      getApiLogger().warn(
        { err: toSafeErrorMessage(err) },
        'Docmost workspace bootstrap admin fallback lookup failed',
      );
      return undefined;
    }
  }
}

export function createBridgeHeaders(opts: {
  secret: string;
  method: string;
  path: string;
  body: string;
}): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(opts.body).digest('hex');
  const signaturePayload = [
    timestamp,
    nonce,
    opts.method.toUpperCase(),
    opts.path,
    bodyHash,
  ].join('\n');
  const signature = createHmac('sha256', opts.secret)
    .update(signaturePayload)
    .digest('hex');

  return {
    Authorization: `Bearer ${opts.secret}`,
    'X-Bridge-Timestamp': timestamp,
    'X-Bridge-Nonce': nonce,
    'X-Bridge-Signature': `sha256=${signature}`,
  };
}

function readHealthResponse(value: unknown): BridgeHealthResponse {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function isWorkspaceInitialized(health: BridgeHealthResponse): boolean {
  if (typeof health.workspace_initialized === 'boolean') {
    return health.workspace_initialized;
  }

  if (typeof health.workspace_count === 'number') {
    return health.workspace_count > 0;
  }

  if (typeof health.workspace_count === 'string') {
    const parsed = Number(health.workspace_count);
    return Number.isFinite(parsed) && parsed > 0;
  }

  return false;
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), DOCMOST_BOOTSTRAP_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal });
}

function generateBootstrapPassword(): string {
  return randomBytes(32).toString('base64url');
}

function toSafeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
