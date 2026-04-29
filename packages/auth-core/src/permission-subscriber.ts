import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PermissionCache, type PermissionCacheRedis } from './permission-cache.js';

export const PERMISSION_CHANGED_PATTERN = 'permission_changed:*';
export const USER_PERMISSION_CHANGED_PATTERN = 'user_permission_changed:*';

export type PermissionSubscriberRedis = PermissionCacheRedis & {
  psubscribe: (...patterns: string[]) => Promise<unknown>;
  punsubscribe: (...patterns: string[]) => Promise<unknown>;
  on: (event: 'pmessage', listener: PermissionSubscriberListener) => unknown;
  off?: (event: 'pmessage', listener: PermissionSubscriberListener) => unknown;
  removeListener?: (event: 'pmessage', listener: PermissionSubscriberListener) => unknown;
  duplicate?: () => PermissionSubscriberRedis;
  disconnect?: () => void;
};

type PermissionSubscriberListener = (pattern: string, channel: string, message: string) => void;

type PermissionChangeMessage = {
  tenant_id?: string;
};

export class PermissionSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly subscriber: PermissionSubscriberRedis | undefined;
  private readonly ownsSubscriber: boolean;
  private subscribed = false;

  private readonly listener: PermissionSubscriberListener = (_pattern, channel, message) => {
    void this.handleMessage(channel, message);
  };

  constructor(
    private readonly cache: PermissionCache,
    redis?: PermissionSubscriberRedis,
  ) {
    const duplicate = redis?.duplicate?.();
    this.subscriber = duplicate ?? redis;
    this.ownsSubscriber = duplicate !== undefined;
  }

  async onModuleInit(): Promise<void> {
    await this.subscribe();
  }

  async subscribe(): Promise<void> {
    if (this.subscriber === undefined || this.subscribed) {
      return;
    }

    this.subscriber.on('pmessage', this.listener);
    await this.subscriber.psubscribe(PERMISSION_CHANGED_PATTERN, USER_PERMISSION_CHANGED_PATTERN);
    this.subscribed = true;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber === undefined || !this.subscribed) {
      return;
    }

    await this.subscriber.punsubscribe(PERMISSION_CHANGED_PATTERN, USER_PERMISSION_CHANGED_PATTERN);
    if (this.subscriber.off !== undefined) {
      this.subscriber.off('pmessage', this.listener);
    } else {
      this.subscriber.removeListener?.('pmessage', this.listener);
    }

    if (this.ownsSubscriber) {
      this.subscriber.disconnect?.();
    }

    this.subscribed = false;
  }

  async handleMessage(channel: string, message = ''): Promise<void> {
    const permissionChangedPrefix = 'permission_changed:';
    const userPermissionChangedPrefix = 'user_permission_changed:';
    const tenantId = parseTenantId(message);

    if (channel.startsWith(permissionChangedPrefix)) {
      const spaceId = channel.slice(permissionChangedPrefix.length);
      if (spaceId.length === 0) {
        return;
      }

      if (tenantId !== undefined) {
        await this.cache.invalidateSpacePermissions(tenantId, spaceId);
      } else {
        await this.cache.invalidateSpacePermissionsAcrossTenants(spaceId);
      }
      return;
    }

    if (channel.startsWith(userPermissionChangedPrefix)) {
      const userId = channel.slice(userPermissionChangedPrefix.length);
      if (userId.length === 0) {
        return;
      }

      if (tenantId !== undefined) {
        await this.cache.invalidateUserPermissions(tenantId, userId);
      } else {
        await this.cache.invalidateUserPermissionsAcrossTenants(userId);
      }
    }
  }
}

function parseTenantId(message: string): string | undefined {
  if (message.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message) as unknown;
    if (!isPermissionChangeMessage(parsed)) {
      return undefined;
    }

    return parsed.tenant_id;
  } catch {
    return undefined;
  }
}

function isPermissionChangeMessage(value: unknown): value is Required<PermissionChangeMessage> {
  if (typeof value !== 'object' || value === null || !('tenant_id' in value)) {
    return false;
  }

  const tenantId = value.tenant_id;
  return typeof tenantId === 'string' && tenantId.length > 0;
}
