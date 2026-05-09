import { describe, expect, it } from 'vitest';

import { AUDIT_EVENTS } from '../audit-events.js';

const EXPECTED_AUDIT_EVENTS = [
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

describe('AUDIT_EVENTS', () => {
  it('defines all 21 mandatory audit events', () => {
    const values = Object.values(AUDIT_EVENTS);

    expect(values).toHaveLength(21);
    expect(new Set(values).size).toBe(21);
  });

  it('matches the expected event strings', () => {
    expect(Object.values(AUDIT_EVENTS)).toEqual(EXPECTED_AUDIT_EVENTS);
  });
});
