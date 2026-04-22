import { defineConfig, devices } from '@playwright/test';

const globalCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet';
const globalRpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (globalCluster === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : globalCluster === 'localnet'
      ? 'http://127.0.0.1:8899'
      : 'https://api.devnet.solana.com');
const stakingRpcUrl =
  process.env.NEXT_PUBLIC_STAKING_RPC_URL ??
  'https://mainnet.helius-rpc.com/?api-key=b457adfa-182d-449a-bf65-74e809efcd77';

export default defineConfig({
  testDir: './e2e',
  outputDir: './.next/playwright/test-results',
  timeout: 45_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3401',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm build && pnpm exec next start -p 3401',
    port: 3401,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SOLANA_CLUSTER: globalCluster,
      NEXT_PUBLIC_RPC_URL: globalRpcUrl,
      NEXT_PUBLIC_STAKING_CLUSTER: process.env.NEXT_PUBLIC_STAKING_CLUSTER ?? 'mainnet-beta',
      NEXT_PUBLIC_STAKING_RPC_URL: stakingRpcUrl,
      NEXT_PUBLIC_STAKING_PROGRAM_NXS_STAKING:
        process.env.NEXT_PUBLIC_STAKING_PROGRAM_NXS_STAKING ??
        'GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z',
      NEXT_PUBLIC_STAKING_STAKE_MINT:
        process.env.NEXT_PUBLIC_STAKING_STAKE_MINT ??
        'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump',
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'playwright-local-session-secret',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
