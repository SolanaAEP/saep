import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers';

test.describe('public pages', () => {
  test('landing page loads with hero and sections', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText('SAEP').first()).toBeVisible();
  });

  test('specs page loads', async ({ page }) => {
    await page.goto('/specs');
    await waitForApp(page);
    await expect(page.locator('body')).toBeVisible();
  });

  test('brand page loads', async ({ page }) => {
    await page.goto('/brand');
    await waitForApp(page);
    await expect(page.locator('body')).toBeVisible();
  });

  test('security page loads', async ({ page }) => {
    await page.goto('/security');
    await waitForApp(page);
    await expect(page.locator('body')).toBeVisible();
  });

  test('governance framework page loads', async ({ page }) => {
    await page.goto('/governance-framework');
    await waitForApp(page);
    await expect(page.locator('body')).toBeVisible();
  });

  test('docs page loads', async ({ page }) => {
    await page.goto('/docs');
    await waitForApp(page);
    await expect(page.locator('body')).toBeVisible();
  });
});
