import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react-router)[\\/]/,
              priority: 30,
            },
            {
              name: 'vendor-antd',
              test: /node_modules[\\/](@ant-design|antd|rc-|dayjs)[\\/]/,
              priority: 20,
              maxSize: 450 * 1024,
            },
            {
              name: 'vendor-graph',
              test: /node_modules[\\/](echarts|zrender|react-force-graph|force-graph|d3-|three|kapsule|ngraph|eventsource-parser)[\\/]/,
              priority: 15,
              maxSize: 450 * 1024,
            },
            {
              name: 'vendor-editor',
              test: /node_modules[\\/](@tiptap|@typespeed|prosemirror|lowlight|highlight.js|marked|react-markdown|remark-|rehype-|micromark|mdast|hast|unified|unist|vfile)[\\/]/,
              priority: 10,
              maxSize: 450 * 1024,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 1,
              maxSize: 450 * 1024,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
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
