import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://buildonsaep.com';

test.describe('wallet context integrity', () => {
  test('no WalletContext errors on dashboard load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('WalletContext')) {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      if (err.message.includes('WalletContext')) {
        errors.push(err.message);
      }
    });

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    expect(errors, `Found ${errors.length} WalletContext errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('no WalletContext errors on marketplace load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('WalletContext')) {
        errors.push(msg.text());
      }
    });

    await page.goto(`${BASE}/marketplace`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    expect(errors, `Found ${errors.length} WalletContext errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('auth gate renders without crash', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    const heading = page.getByRole('heading', { name: 'Sign in' });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test('no ERR banner visible on dashboard', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const errBanner = page.locator('text=/^ERR:/');
    await expect(errBanner).toHaveCount(0);
  });
});
