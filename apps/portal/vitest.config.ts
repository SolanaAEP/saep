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
  },
});
