import { test as base, type BrowserContext, type Browser, chromium } from '@playwright/test';

const CDP_URL = process.env.CDP_URL ?? 'http://127.0.0.1:9222';

export const test = base.extend<{ walletContext: BrowserContext }>({
  walletContext: async ({}, use) => {
    const browser: Browser = await chromium.connectOverCDP(CDP_URL);
    const contexts = browser.contexts();
    const context = contexts[0];
    if (!context) throw new Error('No browser context found — is Chrome running with --remote-debugging-port=9222?');
    await use(context);
  },
});

export { expect } from '@playwright/test';
