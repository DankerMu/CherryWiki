import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import { getApiLogger } from '../common/logger/logger.module.js';

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

@Injectable()
export class DocmostBootstrapService {
  async bootstrapIfNeeded(): Promise<boolean> {
    const config = this.getConfig();
    if (config === undefined) {
      return true;
    }

    try {
      const healthPath = '/api/internal/bridge/health';
      const healthResponse = await fetch(`${config.baseUrl}${healthPath}`, {
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
      const bootstrapResponse = await fetch(`${config.baseUrl}${bootstrapPath}`, {
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
          { email: config.adminEmail, workspace_name: payload.workspaceName },
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

  private getConfig():
    | {
        baseUrl: string;
        secret: string;
        adminEmail: string;
        adminPassword: string;
      }
    | undefined {
    const baseUrl = process.env.DOCMOST_BASE_URL?.trim().replace(/\/+$/, '');
    const secret = process.env.DOCMOST_BRIDGE_SECRET?.trim();
    const adminEmail = process.env.DOCMOST_ADMIN_EMAIL?.trim();
    const adminPassword = process.env.DOCMOST_ADMIN_PASSWORD?.trim();

    if (!baseUrl) {
      return undefined;
    }

    if (!secret || !adminEmail || !adminPassword) {
      getApiLogger().warn(
        {
          docmost_bridge_secret_present: Boolean(secret),
          docmost_admin_email_present: Boolean(adminEmail),
          docmost_admin_password_present: Boolean(adminPassword),
        },
        'Docmost workspace bootstrap is not configured',
      );
      return undefined;
    }

    return { baseUrl, secret, adminEmail, adminPassword };
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

function toSafeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
