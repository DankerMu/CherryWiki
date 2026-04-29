import { TextEncoder } from 'node:util';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

const encoder = new TextEncoder();
const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  tenant_id: string;
  email: string;
  role: string;
  group_ids: string[];
  token_use?: 'access';
}

export interface RefreshTokenPayload extends JWTPayload {
  session_id: string;
  token_use?: 'refresh';
}

export type VerifiedAccessTokenPayload = AccessTokenPayload & {
  token_use: 'access';
};

export async function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  expiresIn = ACCESS_TOKEN_EXPIRES_IN,
): Promise<string> {
  const safePayload: JWTPayload = {
    tenant_id: payload.tenant_id,
    email: payload.email,
    role: payload.role,
    group_ids: [...payload.group_ids],
    token_use: 'access',
  };

  return new SignJWT(safePayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey(secret));
}

export async function signRefreshToken(
  payload: RefreshTokenPayload,
  secret: string,
  expiresIn = REFRESH_TOKEN_EXPIRES_IN,
): Promise<string> {
  return new SignJWT({ session_id: payload.session_id, token_use: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey(secret));
}

export async function verifyToken<T extends JWTPayload = JWTPayload>(token: string, secret: string): Promise<T> {
  const { payload } = await jwtVerify(token, getSecretKey(secret), {
    algorithms: ['HS256'],
  });

  return payload as T;
}

export async function verifyAccessToken(token: string, secret: string): Promise<VerifiedAccessTokenPayload> {
  const payload = await verifyToken<JWTPayload>(token, secret);
  if (!isAccessTokenPayload(payload)) {
    throw new Error('Invalid access token payload');
  }

  return payload;
}

function isAccessTokenPayload(payload: JWTPayload): payload is VerifiedAccessTokenPayload {
  return (
    payload.token_use === 'access' &&
    typeof payload.sub === 'string' &&
    payload.sub.length > 0 &&
    typeof payload.tenant_id === 'string' &&
    payload.tenant_id.length > 0 &&
    typeof payload.email === 'string' &&
    payload.email.length > 0 &&
    typeof payload.role === 'string' &&
    payload.role.length > 0 &&
    Array.isArray(payload.group_ids) &&
    payload.group_ids.every((groupId) => typeof groupId === 'string')
  );
}

function getSecretKey(secret: string): Uint8Array {
  return encoder.encode(secret);
}
