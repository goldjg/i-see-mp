import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mcphound/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@mcphound/storage': resolve(__dirname, 'packages/storage/src/index.ts'),
      '@mcphound/collector': resolve(__dirname, 'packages/collector/src/index.ts'),
      '@mcphound/rules': resolve(__dirname, 'packages/rules/src/index.ts'),
      '@mcphound/graph': resolve(__dirname, 'packages/graph/src/index.ts'),
      '@mcphound/api': resolve(__dirname, 'apps/api/src/server.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
  },
});
