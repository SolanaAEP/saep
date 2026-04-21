import { test, expect } from './wallet-fixture';
import { waitForApp } from './helpers';

const BASE = process.env.BASE_URL ?? 'https://buildonsaep.com';
const hasUnlockedWalletSession = process.env.ENABLE_WALLET_SESSION_E2E === '1';

test.describe.serial('wallet session (requires unlocked wallet)', () => {
  test.setTimeout(300_000);
  test.skip(
    !hasUnlockedWalletSession,
    'Set ENABLE_WALLET_SESSION_E2E=1 with an unlocked wallet browser session to run wallet session tests.',
  );

  test('dashboard shows operator overview', async ({ walletContext }) => {
    // Use the existing page where user already authenticated
    const pages = walletContext.pages();
    const page = pages.find(p => p.url().includes('buildonsaep.com')) ?? pages[0];
    if (!page) throw new Error('No page found — navigate to buildonsaep.com/dashboard first');

    // If not on dashboard, navigate there
    if (!page.url().includes('/dashboard')) {
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    }

    const signOut = page.getByRole('button', { name: 'Sign out' });
    await expect(signOut).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('operator overview', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('session shows truncated address', async ({ walletContext }) => {
    const page = walletContext.pages().find(p => p.url().includes('buildonsaep.com'))!;
    if (!page.url().includes('/dashboard')) {
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    }
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 });
    const addr = page.locator('text=/^[A-Za-z0-9]{4}…[A-Za-z0-9]{4}$/');
    await expect(addr).toBeVisible();
  });

  test('navigate to marketplace', async ({ walletContext }) => {
    const page = walletContext.pages().find(p => p.url().includes('buildonsaep.com'))!;
    await page.getByRole('link', { name: 'Marketplace' }).click();
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  });

  test('navigate to treasury', async ({ walletContext }) => {
    const page = walletContext.pages().find(p => p.url().includes('buildonsaep.com'))!;
    await page.getByRole('link', { name: 'Treasury' }).click();
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'Treasury' })).toBeVisible();
  });

  test('navigate to governance', async ({ walletContext }) => {
    const page = walletContext.pages().find(p => p.url().includes('buildonsaep.com'))!;
    await page.getByRole('link', { name: 'Governance' }).click();
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'Governance' })).toBeVisible();
  });

  test('navigate to leaderboard', async ({ walletContext }) => {
    const page = walletContext.pages().find(p => p.url().includes('buildonsaep.com'))!;
    await page.getByRole('link', { name: 'Leaderboard' }).click();
    await waitForApp(page);
    await expect(page.locator('body')).toBeVisible();
  });

  test('sign out returns to auth gate', async ({ walletContext }) => {
    const page = walletContext.pages().find(p => p.url().includes('buildonsaep.com'))!;
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
  });
});
