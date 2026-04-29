import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';

import { ROLES } from '../constants.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from '../jwt.js';

const SECRET = 'test-secret-with-enough-entropy';

describe('jwt utilities', () => {
  it('signs an access token with the expected claims', async () => {
    const token = await signAccessToken(createAccessPayload(), SECRET);
    const decoded = decodeJwt(token);

    expect(decoded.sub).toBe('user-1');
    expect(decoded.tenant_id).toBe('tenant-1');
    expect(decoded.email).toBe('user@example.com');
    expect(decoded.role).toBe(ROLES.VIEWER);
    expect(decoded.group_ids).toEqual(['group-1', 'group-2']);
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
  });

  it('does not include password_hash from an unsafe input object', async () => {
    const unsafePayload = {
      ...createAccessPayload(),
      password_hash: 'must-not-be-signed',
    };

    const token = await signAccessToken(unsafePayload, SECRET);
    const decoded = decodeJwt(token);

    expect(decoded).not.toHaveProperty('password_hash');
  });

  it('verifies a valid token', async () => {
    const token = await signAccessToken(createAccessPayload(), SECRET);

    await expect(verifyToken<AccessTokenPayload>(token, SECRET)).resolves.toMatchObject({
      sub: 'user-1',
      tenant_id: 'tenant-1',
      email: 'user@example.com',
    });
  });

  it('throws for an expired token', async () => {
    const token = await signAccessToken(createAccessPayload(), SECRET, '-1s');

    await expect(verifyToken<AccessTokenPayload>(token, SECRET)).rejects.toThrow();
  });

  it('signs a refresh token with session_id', async () => {
    const token = await signRefreshToken({ session_id: 'session-1' }, SECRET);

    await expect(verifyToken<RefreshTokenPayload>(token, SECRET)).resolves.toMatchObject({
      session_id: 'session-1',
    });
  });
});

function createAccessPayload(): AccessTokenPayload {
  return {
    sub: 'user-1',
    tenant_id: 'tenant-1',
    email: 'user@example.com',
    role: ROLES.VIEWER,
    group_ids: ['group-1', 'group-2'],
  };
}
