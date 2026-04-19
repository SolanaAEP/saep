import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      all: false,
      exclude: ['src/**/__tests__/**', 'src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        statements: 89,
        branches: 85,
        functions: 85,
        lines: 91,
      },
    },
  },
});
