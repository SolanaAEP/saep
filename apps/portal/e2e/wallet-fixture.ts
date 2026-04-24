import { test as base, type BrowserContext, type Browser, chromium } from '@playwright/test';

const CDP_URL = process.env.CDP_URL ?? 'http://127.0.0.1:9222';

export const test = base.extend<{ walletContext: BrowserContext }>({
  walletContext: async ({}, use) => {
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
    } catch (error) {
      throw new Error(
        `Unable to connect to Chrome over CDP at ${CDP_URL}. Run 'pnpm e2e:wallet:open', unlock your wallet in that browser window, then re-run 'pnpm e2e:wallet'.`,
        { cause: error },
      );
    }
    const contexts = browser.contexts();
    const context = contexts[0];
    if (!context) {
      throw new Error(
        `No browser context found at ${CDP_URL}. Launch Chrome with 'pnpm e2e:wallet:open' and keep that window open while Playwright runs.`,
      );
    }
    await use(context);
  },
});

export { expect } from '@playwright/test';
