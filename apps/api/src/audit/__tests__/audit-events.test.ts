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
  'admin.group.create',
  'user.group_change',
  'space.create',
  'space.update',
  'space.permission_change',
  'admin.model.create',
  'admin.model.update',
  'admin.model.test',
] as const;

describe('AUDIT_EVENTS', () => {
  it('defines all 17 mandatory audit events', () => {
    const values = Object.values(AUDIT_EVENTS);

    expect(values).toHaveLength(17);
    expect(new Set(values).size).toBe(17);
  });

  it('matches the expected event strings', () => {
    expect(Object.values(AUDIT_EVENTS)).toEqual(EXPECTED_AUDIT_EVENTS);
  });
});
