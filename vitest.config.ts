import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: [
      {
        find: /^@cherrygraph\/([^/]+)$/,
        replacement: path.join(rootDir, 'packages/$1/src/index.ts'),
      },
      {
        find: /^@cherrygraph\/([^/]+)\/(.*)$/,
        replacement: path.join(rootDir, 'packages/$1/src/$2'),
      },
    ],
  },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'apps/**/src/**/*.test.tsx', 'tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'apps/web/**'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        '**/index.ts',
        '**/main.ts',
        '**/schema/**',
      ],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
      },
    },
  },
});
