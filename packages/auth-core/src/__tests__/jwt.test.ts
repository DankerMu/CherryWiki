import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';

import { ROLES } from '../constants.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
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
    expect(decoded.token_use).toBe('access');
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

  it('does not include refresh_token from an unsafe input object', async () => {
    const unsafePayload = {
      ...createAccessPayload(),
      refresh_token: 'must-not-be-signed',
    };

    const token = await signAccessToken(unsafePayload, SECRET);
    const decoded = decodeJwt(token);

    expect(decoded).not.toHaveProperty('refresh_token');
  });

  it('includes the required access token auth context claims', async () => {
    const token = await signAccessToken(createAccessPayload(), SECRET);
    const decoded = decodeJwt(token);

    for (const claim of ['sub', 'tenant_id', 'email', 'role', 'group_ids', 'iat', 'exp']) {
      expect(decoded).toHaveProperty(claim);
    }
  });

  it('verifies a valid token', async () => {
    const token = await signAccessToken(createAccessPayload(), SECRET);

    await expect(verifyAccessToken(token, SECRET)).resolves.toMatchObject({
      sub: 'user-1',
      tenant_id: 'tenant-1',
      email: 'user@example.com',
      token_use: 'access',
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
      token_use: 'refresh',
    });
  });

  it('rejects a refresh token as an access token', async () => {
    const token = await signRefreshToken({ session_id: 'session-1' }, SECRET);

    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
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
