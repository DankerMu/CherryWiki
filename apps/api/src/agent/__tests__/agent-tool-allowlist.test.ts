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
    const settings = new SettingsGenerator().generate({
      workDir: '/tmp/work',
      graphPaths: ['/data/graphs/space-a'],
    });

    expect(settings.tools).toEqual(['Bash', 'Read']);
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining([
        'Bash(cherrywiki *)',
        'Bash(graphify *)',
        'Bash(cherrydb *)',
        'Read(/tmp/work)',
        'Read(/data/graphs/space-a)',
      ]),
    );
    expect(settings.permissions.allow).not.toContain('Read(*)');
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        'Write',
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
        'Task',
        'Bash(rm *)',
        'Bash(curl *)',
        'Bash(wget *)',
        'Bash(chmod *)',
        'Bash(chown *)',
        'Bash(python *)',
        'Bash(node *)',
        'Bash(sh *)',
        'Bash(bash -c *)',
        'Bash(echo * > *)',
        'Bash(cat * > *)',
        'Bash(tee *)',
      ]),
    );
    expect(settings).not.toHaveProperty('env');
    expect(settings).not.toHaveProperty('model');
  });

  it('rejects relative and traversal graph paths while deduplicating read scopes', () => {
    const settings = new SettingsGenerator().generate({
      workDir: '/tmp/work',
      graphPaths: [
        'relative/graph',
        '/data/graphs/space-a/../space-b',
        null as unknown as string,
        undefined as unknown as string,
        '',
        '/data/graphs/space-a',
        '/data/graphs/space-a',
      ],
    });

    expect(settings.permissions.allow).toContain('Read(/tmp/work)');
    expect(settings.permissions.allow).toContain('Read(/data/graphs/space-a)');
    expect(settings.permissions.allow).not.toContain('Read(relative/graph)');
    expect(settings.permissions.allow).not.toContain('Read(/data/graphs/space-b)');
    expect(settings.permissions.allow.filter((permission) => permission === 'Read(/data/graphs/space-a)')).toHaveLength(
      1,
    );
    expect(settings.permissions.allow).not.toContain('Read(*)');
  });

  it('does not copy unrelated server environment variables into settings.json', () => {
    process.env.DATABASE_URL = 'postgres://server-secret';
    process.env.JWT_SECRET = 'jwt-secret';

    const settings = new SettingsGenerator().generate({
      workDir: '/tmp/work',
      graphPaths: [],
    });

    expect(settings).not.toHaveProperty('env');
    expect(settings.permissions.deny).toContain('Task');
  });
});
