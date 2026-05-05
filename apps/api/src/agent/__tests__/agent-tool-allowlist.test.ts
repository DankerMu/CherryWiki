import 'reflect-metadata';

import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { SettingsGenerator } from '../settings-generator.js';

void spawn;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalJwtSecret = process.env.JWT_SECRET;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

describe('SettingsGenerator tool allowlist', () => {
  it('allows only Bash and Read tools while denying mutation and network tools', () => {
    const settings = new SettingsGenerator().generate();

    expect(settings.tools).toEqual(['Bash', 'Read']);
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining(['Bash(cherrywiki *)', 'Bash(graphify *)', 'Bash(cherrydb *)', 'Read(*)']),
    );
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'WebFetch', 'WebSearch', 'Bash(rm *)', 'Bash(curl *)']),
    );
    expect(settings).not.toHaveProperty('env');
    expect(settings).not.toHaveProperty('model');
  });

  it('does not copy unrelated server environment variables into settings.json', () => {
    process.env.DATABASE_URL = 'postgres://server-secret';
    process.env.JWT_SECRET = 'jwt-secret';

    const settings = new SettingsGenerator().generate();

    expect(settings).not.toHaveProperty('env');
    expect(settings.permissions.deny).toContain('Task');
  });
});
