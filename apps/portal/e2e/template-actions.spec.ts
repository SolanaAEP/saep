import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers';

test.describe('template action routes', () => {
  test('renders disconnected rentals state', async ({ page }) => {
    await page.goto('/templates/rentals');
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'My template rentals' })).toBeVisible();
    await expect(page.getByText('CONNECT WALLET TO VIEW RENTALS')).toBeVisible();
  });

  test('rent and fork routes handle invalid template ids without wallet state', async ({ page }) => {
    await page.goto('/templates/not-a-template/rent');
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'Template not found' })).toBeVisible();

    await page.goto('/templates/not-a-template/fork');
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'Template not found' })).toBeVisible();
  });
});
