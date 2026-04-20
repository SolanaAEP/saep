import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://buildonsaep.com';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'default',
      testIgnore: /wallet-session/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'wallet',
      testMatch: /wallet-session/,
      use: { browserName: 'chromium' },
    },
  ],

  ...(process.env.BASE_URL?.includes('localhost')
    ? {
        webServer: {
          command: 'npm run dev',
          port: Number(process.env.PORTAL_PORT ?? 3000),
          reuseExistingServer: true,
          timeout: 30_000,
        },
      }
    : {}),
});
