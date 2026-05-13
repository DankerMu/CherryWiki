import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { signAccessToken, type AuthenticatedRequestUser } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_METADATA_KEY } from '../../common/guards/rate-limit.guard.js';
import { configureApp } from '../../main.js';
import { AuthController } from '../auth.controller.js';
import { AuthModule } from '../auth.module.js';
import {
  AuthService,
  type AuthRequestMetadata,
  type ChangePasswordInput,
  type CurrentUserResponse,
  type LoginInput,
  type LoginResult,
  type LogoutInput,
  type TokenPairResult,
} from '../auth.service.js';
import {
  SessionService,
  type ListSessionsInput,
  type RevokeSessionInput,
  type SessionSummary,
} from '../session.service.js';
import { TEST_EMAIL, TEST_JWT_SECRET, TEST_TENANT_ID, TEST_USER_ID } from './auth-test-utils.js';

type AuthServiceMock = {
  login: ReturnType<
    typeof vi.fn<(input: LoginInput, metadata?: AuthRequestMetadata) => Promise<LoginResult>>
  >;
  refresh: ReturnType<
    typeof vi.fn<
      (refreshToken: string, metadata?: AuthRequestMetadata) => Promise<TokenPairResult>
    >
  >;
  logout: ReturnType<
    typeof vi.fn<
      (
        user: AuthenticatedRequestUser,
        input?: LogoutInput,
        metadata?: AuthRequestMetadata,
      ) => Promise<{ success: true }>
    >
  >;
  getCurrentUser: ReturnType<
    typeof vi.fn<(user: AuthenticatedRequestUser) => Promise<CurrentUserResponse>>
  >;
  changePassword: ReturnType<
    typeof vi.fn<
      (
        user: AuthenticatedRequestUser,
        input: ChangePasswordInput,
        metadata?: AuthRequestMetadata,
      ) => Promise<{ success: true }>
    >
  >;
};

type SessionServiceMock = {
  listActiveSessions: ReturnType<
    typeof vi.fn<(input: ListSessionsInput) => Promise<SessionSummary[]>>
  >;
  revokeSession: ReturnType<
    typeof vi.fn<(input: RevokeSessionInput) => Promise<{ revoked: true }>>
  >;
};

const originalJwtSecret = process.env.JWT_SECRET;

let app: NestFastifyApplication | undefined;
let authServiceMock: AuthServiceMock;
let sessionServiceMock: SessionServiceMock;

describe('AuthController', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    authServiceMock = createAuthServiceMock();
    sessionServiceMock = createSessionServiceMock();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
    restoreJwtSecret();
  });

  it('applies the login rate-limit decorator', () => {
    const loginHandler = getControllerMethod(AuthController.prototype, 'login');
    const metadata = Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, loginHandler) as unknown;

    expect(metadata).toEqual({ limit: 10, windowSec: 60, mode: 'ip' });
  });

  it('applies the refresh rate-limit decorator', () => {
    const refreshHandler = getControllerMethod(AuthController.prototype, 'refresh');
    const metadata = Reflect.getMetadata(RATE_LIMIT_METADATA_KEY, refreshHandler) as unknown;

    expect(metadata).toEqual({ limit: 30, windowSec: 60, mode: 'ip' });
  });

  it('POST /api/auth/login sets the refresh cookie and omits it from the body', async () => {
    app = await createTestApp();
    authServiceMock.login.mockResolvedValue(createLoginResponse());

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'Correct1!' })
      .expect(200);

    const body = parseJsonObject(response.text);
    expect(body.data).toMatchObject({
      access_token: 'access-token',
      expires_in: 3600,
      user: {
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        name: 'Test User',
        role: 'editor',
        groups: ['group-1'],
      },
    });
    expect(body.data).not.toHaveProperty('refresh_token');
    expect(response.headers['set-cookie']?.[0]).toContain('refresh_token=refresh-token');
    expect(authServiceMock.login).toHaveBeenCalledWith(
      expect.objectContaining({ email: TEST_EMAIL, password: 'Correct1!' }),
      expect.any(Object),
    );
  });

  it('POST /api/auth/refresh accepts a cookie and rotates it without returning it in the body', async () => {
    app = await createTestApp();
    authServiceMock.refresh.mockResolvedValue({
      access_token: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expires_in: 3600,
    });

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/refresh')
      .set('Cookie', ['refresh_token=old-refresh-token'])
      .expect(200);

    expect(parseJsonObject(response.text).data).toMatchObject({
      access_token: 'new-access-token',
      expires_in: 3600,
    });
    expect(parseJsonObject(response.text).data).not.toHaveProperty('refresh_token');
    expect(response.headers['set-cookie']?.[0]).toContain('refresh_token=new-refresh-token');
    expect(authServiceMock.refresh).toHaveBeenCalledWith('old-refresh-token', expect.any(Object));
  });

  it('POST /api/auth/refresh requires a refresh cookie', async () => {
    app = await createTestApp();

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/refresh')
      .expect(401);

    expect(getErrorPayload(response.text).code).toBe(ErrorCode.INVALID_REFRESH_TOKEN);
    expect(authServiceMock.refresh).not.toHaveBeenCalled();
  });

  it('POST /api/auth/refresh maps invalid refresh cookies to 401', async () => {
    app = await createTestApp();
    authServiceMock.refresh.mockRejectedValue(
      new HttpException(
        {
          code: ErrorCode.INVALID_REFRESH_TOKEN,
          message: 'Invalid refresh token',
        },
        HttpStatus.UNAUTHORIZED,
      ),
    );

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/refresh')
      .set('Cookie', ['refresh_token=bad-refresh-token'])
      .expect(401);

    expect(getErrorPayload(response.text).code).toBe(ErrorCode.INVALID_REFRESH_TOKEN);
  });

  it('POST /api/auth/refresh rejects duplicate refresh cookies', async () => {
    app = await createTestApp();

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=first-refresh-token; refresh_token=second-refresh-token')
      .expect(401);

    expect(getErrorPayload(response.text).code).toBe(ErrorCode.INVALID_REFRESH_TOKEN);
    expect(authServiceMock.refresh).not.toHaveBeenCalled();
  });

  it('POST /api/auth/logout requires auth and returns success', async () => {
    app = await createTestApp();
    authServiceMock.logout.mockResolvedValue({ success: true });

    await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/logout')
      .send({})
      .expect(401);

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${await createAccessToken()}`)
      .set('Cookie', ['refresh_token=refresh-token'])
      .expect(200);

    expect(parseJsonObject(response.text).data).toEqual({ success: true });
    expect(response.headers['set-cookie']?.[0]).toContain('refresh_token=');
    expect(response.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    expect(authServiceMock.logout).toHaveBeenCalledWith(
      expect.objectContaining({ sub: TEST_USER_ID, tenant_id: TEST_TENANT_ID }),
      expect.objectContaining({ refreshToken: 'refresh-token' }),
      expect.any(Object),
    );
  });

  it('POST /api/auth/logout works without a refresh cookie', async () => {
    app = await createTestApp();
    authServiceMock.logout.mockResolvedValue({ success: true });

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${await createAccessToken()}`)
      .expect(200);

    expect(parseJsonObject(response.text).data).toEqual({ success: true });
    expect(response.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    expect(authServiceMock.logout).toHaveBeenCalledWith(
      expect.objectContaining({ sub: TEST_USER_ID, tenant_id: TEST_TENANT_ID }),
      expect.objectContaining({ refreshToken: undefined }),
      expect.any(Object),
    );
  });

  it('GET /api/auth/me requires auth and returns the current user shape', async () => {
    app = await createTestApp();
    authServiceMock.getCurrentUser.mockResolvedValue(createCurrentUserResponse());

    await request(app.getHttpAdapter().getInstance().server).get('/api/auth/me').expect(401);

    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${await createAccessToken()}`)
      .expect(200);

    expect(parseJsonObject(response.text).data).toEqual(createCurrentUserResponse());
  });

  it('POST /api/auth/password/change returns success', async () => {
    app = await createTestApp();
    authServiceMock.changePassword.mockResolvedValue({ success: true });

    const response = await request(app.getHttpAdapter().getInstance().server)
      .post('/api/auth/password/change')
      .set('Authorization', `Bearer ${await createAccessToken()}`)
      .send({ current_password: 'Correct1!', new_password: 'Newpass1!' })
      .expect(200);

    expect(parseJsonObject(response.text).data).toEqual({ success: true });
  });

  it('GET /api/auth/sessions returns active session summaries', async () => {
    app = await createTestApp();
    sessionServiceMock.listActiveSessions.mockResolvedValue([
      {
        id: 'session-1',
        ip: '203.0.113.10',
        user_agent: 'vitest-agent',
        created_at: new Date('2026-04-29T10:00:00.000Z'),
        last_used_at: new Date('2026-04-29T11:00:00.000Z'),
        is_current: true,
      },
    ]);

    const response = await request(app.getHttpAdapter().getInstance().server)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${await createAccessToken()}`)
      .expect(200);

    expect(parseJsonObject(response.text).data).toEqual([
      {
        id: 'session-1',
        ip: '203.0.113.10',
        user_agent: 'vitest-agent',
        created_at: '2026-04-29T10:00:00.000Z',
        last_used_at: '2026-04-29T11:00:00.000Z',
        is_current: true,
      },
    ]);
  });

  it('GET /api/auth/sessions passes the access token session_id to the service', async () => {
    app = await createTestApp();
    sessionServiceMock.listActiveSessions.mockResolvedValue([]);

    await request(app.getHttpAdapter().getInstance().server)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${await createAccessToken({ session_id: 'session-from-token' })}`)
      .expect(200);

    expect(sessionServiceMock.listActiveSessions).toHaveBeenCalledWith({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      currentSessionId: 'session-from-token',
    });
  });

  it('DELETE /api/auth/sessions/:session_id revokes an owned session', async () => {
    app = await createTestApp();
    sessionServiceMock.revokeSession.mockResolvedValue({ revoked: true });

    const response = await request(app.getHttpAdapter().getInstance().server)
      .delete('/api/auth/sessions/session-1')
      .set('Authorization', `Bearer ${await createAccessToken()}`)
      .expect(200);

    expect(parseJsonObject(response.text).data).toEqual({ revoked: true });
    expect(sessionServiceMock.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEST_TENANT_ID,
        userId: TEST_USER_ID,
        sessionId: 'session-1',
      }),
    );
  });
});

async function createTestApp(): Promise<NestFastifyApplication> {
  const builder = Test.createTestingModule({
    imports: [AuthModule],
  });
  builder.overrideProvider(AuthService).useValue(authServiceMock);
  builder.overrideProvider(SessionService).useValue(sessionServiceMock);

  const moduleRef = await builder.compile();
  const testApp = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );
  configureApp(testApp);
  await testApp.init();
  await testApp.getHttpAdapter().getInstance().ready();
  return testApp;
}

function createAuthServiceMock(): AuthServiceMock {
  return {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    changePassword: vi.fn(),
  };
}

function createSessionServiceMock(): SessionServiceMock {
  return {
    listActiveSessions: vi.fn(),
    revokeSession: vi.fn(),
  };
}

function createLoginResponse(): LoginResult {
  return {
    access_token: 'access-token',
    refreshToken: 'refresh-token',
    expires_in: 3600,
    user: {
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      name: 'Test User',
      role: 'editor',
      groups: ['group-1'],
    },
  };
}

function createCurrentUserResponse(): CurrentUserResponse {
  return {
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    name: 'Test User',
    role: 'editor',
    groups: [{ id: 'group-1', name: 'Editors' }],
    spaces: [{ id: 'space-1', name: 'Space One', role: 'editor' }],
  };
}

async function createAccessToken(
  overrides: Partial<Parameters<typeof signAccessToken>[0]> = {},
): Promise<string> {
  return signAccessToken(
    {
      sub: TEST_USER_ID,
      tenant_id: TEST_TENANT_ID,
      email: TEST_EMAIL,
      role: 'editor',
      group_ids: ['group-1'],
      ...overrides,
    },
    TEST_JWT_SECRET,
  );
}

function getErrorPayload(text: string): Record<string, unknown> {
  const body = parseJsonObject(text);
  const error = body.error;
  if (!isRecord(error)) {
    throw new Error('Expected error payload');
  }

  return error;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object');
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getControllerMethod(prototype: object, methodName: string): object {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
  const value = descriptor?.value as unknown;
  if (typeof value !== 'function') {
    throw new Error(`Expected ${methodName} to be a controller method`);
  }

  return value;
}

function restoreJwtSecret(): void {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
    return;
  }

  process.env.JWT_SECRET = originalJwtSecret;
}
