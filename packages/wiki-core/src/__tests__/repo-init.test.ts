import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initWikiRepo } from '../repo-init.js';

describe('initWikiRepo', () => {
  let basePath: string;

  beforeEach(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-core-'));
  });

  afterEach(() => {
    fs.rmSync(basePath, { force: true, recursive: true });
  });

  it('creates the expected directory structure', () => {
    const spacePath = initWikiRepo(basePath, 'rd-platform');

    for (const dir of ['pages', 'communities', 'god-nodes', '_attachments', '_metadata']) {
      expect(fs.statSync(path.join(spacePath, dir)).isDirectory()).toBe(true);
    }
  });

  it('is idempotent on an existing repo', () => {
    const firstPath = initWikiRepo(basePath, 'rd-platform');
    fs.writeFileSync(path.join(firstPath, '_metadata', 'pages.jsonl'), 'existing\n', 'utf-8');
    const secondPath = initWikiRepo(basePath, 'rd-platform');

    expect(secondPath).toBe(firstPath);
    expect(fs.readFileSync(path.join(secondPath, '_metadata', 'pages.jsonl'), 'utf-8')).toBe('existing\n');
  });

  it('returns the space path', () => {
    expect(initWikiRepo(basePath, 'rd-platform')).toBe(path.join(basePath, 'spaces', 'rd-platform'));
  });

  it('creates an empty pages.jsonl file', () => {
    const spacePath = initWikiRepo(basePath, 'rd-platform');

    expect(fs.readFileSync(path.join(spacePath, '_metadata', 'pages.jsonl'), 'utf-8')).toBe('');
  });

  it('rejects path traversal space ids', () => {
    expect(() => initWikiRepo(basePath, '../../etc')).toThrow();
  });
});
