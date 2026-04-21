import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers';

test.describe('responsive layout', () => {
  test('landing page renders at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('body')).toBeVisible();
  });

  test('landing page renders at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('body')).toBeVisible();
  });

  test('app layout renders at 1920px', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/dashboard');
    await waitForApp(page);
    await expect(page.getByText('SAEP APP // OPERATOR SURFACE')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
