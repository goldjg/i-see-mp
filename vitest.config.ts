import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@iseemp/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@iseemp/storage': resolve(__dirname, 'packages/storage/src/index.ts'),
      '@iseemp/collector': resolve(__dirname, 'packages/collector/src/index.ts'),
      '@iseemp/rules': resolve(__dirname, 'packages/rules/src/index.ts'),
      '@iseemp/graph': resolve(__dirname, 'packages/graph/src/index.ts'),
      '@iseemp/api': resolve(__dirname, 'apps/api/src/server.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
  },
});
