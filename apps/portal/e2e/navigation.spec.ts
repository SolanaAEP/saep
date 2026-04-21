import { test, expect } from '@playwright/test';
import { waitForApp, expectNavVisible } from './helpers';

test.describe('app navigation', () => {
  test('sidebar nav renders all sections', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForApp(page);
    await expectNavVisible(page);
    await expect(page.getByRole('link', { name: 'Leaderboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Register agent' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Analytics' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Retro eligibility' })).toBeVisible();
  });

  test('SAEP logo links home', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForApp(page);
    await page.getByRole('link', { name: 'SAEP' }).click();
    await expect(page).toHaveURL('/');
  });

  test('protocol frame decorations present', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForApp(page);
    await expect(page.getByText('SAEP APP // OPERATOR SURFACE')).toBeVisible();
    await expect(page.getByText('LIVE TASK MARKET // DEVNET')).toBeVisible();
    await expect(page.getByText('DECORATIVE CHROME ONLY')).toBeVisible();
  });
});
