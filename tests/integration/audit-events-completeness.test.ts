import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../../apps/api/src/audit/audit-events.js';

const REQUIRED_AUDIT_EVENTS = [
  'auth.login',
  'auth.logout',
  'auth.token_refresh',
  'auth.failed_login',
  'auth.password_change',
  'auth.session_revoke',
  'admin.user.create',
  'admin.user.update',
  'admin.user.disable',
  'admin.user.delete',
  'admin.group.create',
  'admin.group.delete',
  'user.group_change',
  'space.create',
  'space.update',
  'space.archive',
  'space.permission_change',
  'admin.model.create',
  'admin.model.update',
  'admin.model.test',
  'chat.completion',
] as const;

describe('audit event completeness', () => {
  it('defines all 21 required audit events', () => {
    const definedEvents = Object.values(AUDIT_EVENTS);

    expect(definedEvents).toHaveLength(21);
    expect(new Set(definedEvents).size).toBe(21);
    expect(new Set(definedEvents)).toEqual(new Set(REQUIRED_AUDIT_EVENTS));
  });
});
