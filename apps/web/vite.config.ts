import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const webPort = Number(process.env.WEB_PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number.isInteger(webPort) && webPort > 0 ? webPort : 5173,
    proxy: {
      '/api': {
        target: process.env.API_BASE_URL ?? 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['antd', '@ant-design/icons', 'i18next', 'react-i18next'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/__tests__/setup.ts'],
    passWithNoTests: true,
    testTimeout: 15000,
  },
});
