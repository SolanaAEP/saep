import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    alias: {
      '@/': path.resolve(__dirname, 'src') + '/',
      '@saep/sdk': path.resolve(__dirname, '../../packages/sdk/src/index.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      all: false,
      include: ['src/app/api/auth/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.ts'],
      thresholds: {
        statements: 55,
        branches: 56,
        functions: 70,
        lines: 55,
      },
    },
  },
});
