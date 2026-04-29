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
}

export interface RefreshTokenPayload extends JWTPayload {
  session_id: string;
}

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
  return new SignJWT({ session_id: payload.session_id })
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

function getSecretKey(secret: string): Uint8Array {
  return encoder.encode(secret);
}
