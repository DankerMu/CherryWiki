#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const args = process.argv.slice(2);
const filter = readFilter(args);

const commandArgs =
  filter === null
    ? ['-r', '--if-present', 'test', ...args]
    : ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', ...testRootsForFilter(filter)];

const result = spawnSync('pnpm', commandArgs, {
  cwd: rootDir,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function readFilter(values) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--filter') {
      return values[index + 1] ?? null;
    }

    if (value?.startsWith('--filter=')) {
      return value.slice('--filter='.length);
    }
  }

  return null;
}

function testRootsForFilter(filterValue) {
  const workspacePackages = readWorkspacePackages();
  const normalizedFilter = normalizePackageName(filterValue);
  const matches = workspacePackages.filter((workspacePackage) => {
    return (
      workspacePackage.name === filterValue ||
      workspacePackage.name.endsWith(`/${filterValue}`) ||
      normalizePackageName(workspacePackage.name) === normalizedFilter ||
      workspacePackage.dir === filterValue
    );
  });

  if (matches.length === 0) {
    return [filterValue];
  }

  return matches.map((workspacePackage) => path.posix.join(workspacePackage.dir, 'src'));
}

function readWorkspacePackages() {
  const workspaceGlobs = ['packages', 'apps'];
  const packages = [];

  for (const workspaceGlob of workspaceGlobs) {
    const absoluteWorkspaceDir = path.join(rootDir, workspaceGlob);
    if (!existsSync(absoluteWorkspaceDir)) {
      continue;
    }

    const entries = readDirectoryNames(absoluteWorkspaceDir);
    for (const entry of entries) {
      const packageDir = path.join(absoluteWorkspaceDir, entry);
      const packageJsonPath = path.join(packageDir, 'package.json');
      if (!existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (typeof packageJson.name === 'string') {
        packages.push({
          name: packageJson.name,
          dir: path.posix.join(workspaceGlob, entry),
        });
      }
    }
  }

  return packages;
}

function readDirectoryNames(directory) {
  return readdirSync(directory).filter((entry) => statSync(path.join(directory, entry)).isDirectory());
}

function normalizePackageName(packageName) {
  return packageName.replace(/^@[^/]+\//, '');
}
