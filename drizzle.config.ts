import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/shared/src/schema/index.ts',
  out: './schemas/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
