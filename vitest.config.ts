import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
    include: ['packages/**/src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
