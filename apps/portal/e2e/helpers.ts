import { type Page, expect } from '@playwright/test';

export async function waitForApp(page: Page) {
  await page.waitForLoadState('domcontentloaded');
}

export async function expectNavVisible(page: Page) {
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Marketplace' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Treasury' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Governance' })).toBeVisible();
}

export async function navigateTo(page: Page, label: string) {
  await page.getByRole('link', { name: label }).click();
  await waitForApp(page);
}

export async function isAuthenticated(page: Page): Promise<boolean> {
  const signOut = page.getByRole('button', { name: 'Sign out' });
  return signOut.isVisible({ timeout: 3_000 }).catch(() => false);
}

export async function expectAuthGate(page: Page) {
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
}
