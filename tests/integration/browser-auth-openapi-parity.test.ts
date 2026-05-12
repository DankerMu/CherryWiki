import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser auth OpenAPI parity', () => {
  it('keeps login, refresh, and logout aligned with the cookie-based controller contract', () => {
    const openapi = readFileSync(new URL('../../docs/schemas/openapi.yaml', import.meta.url), 'utf8');
    const loginEndpoint = sliceBetween(openapi, '  /auth/login:', '  /auth/logout:');
    const logoutEndpoint = sliceBetween(openapi, '  /auth/logout:', '  /auth/me:');
    const refreshEndpoint = sliceBetween(openapi, '  /auth/refresh:', '  /auth/password/change:');
    const loginSchema = sliceBetween(
      openapi,
      '    BrowserLoginResponse:',
      '    BrowserRefreshResponse:',
    );
    const refreshSchema = sliceBetween(openapi, '    BrowserRefreshResponse:', '    # --- User ---');

    expect(loginEndpoint).toContain('#/components/schemas/BrowserLoginResponse');
    expect(loginEndpoint).toContain('Set-Cookie:');
    expect(loginSchema).not.toContain('refresh_token');
    expect(loginSchema).toContain('required: [access_token, expires_in, user]');
    expect(loginSchema).toContain('items: { type: string }');

    expect(refreshEndpoint).toContain('#/components/schemas/BrowserRefreshResponse');
    expect(refreshEndpoint).toContain('Set-Cookie:');
    expect(refreshEndpoint).not.toContain('requestBody:');
    expect(refreshSchema).not.toContain('refresh_token');
    expect(refreshSchema).not.toContain('user:');

    expect(logoutEndpoint).not.toContain('requestBody:');
  });
});

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`OpenAPI marker not found: ${start}`);
  }

  return source.slice(startIndex, endIndex);
}
