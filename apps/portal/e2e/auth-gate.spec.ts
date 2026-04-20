import { test, expect } from '@playwright/test';
import { waitForApp, expectAuthGate, expectNavVisible } from './helpers';

test.describe('auth gate', () => {
  test('dashboard requires auth', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('marketplace requires auth', async ({ page }) => {
    await page.goto('/marketplace');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('treasury requires auth', async ({ page }) => {
    await page.goto('/treasury');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('governance requires auth', async ({ page }) => {
    await page.goto('/governance');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('tasks requires auth', async ({ page }) => {
    await page.goto('/tasks');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('agent register requires auth', async ({ page }) => {
    await page.goto('/agents/register');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('analytics requires auth', async ({ page }) => {
    await page.goto('/analytics');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('leaderboard requires auth', async ({ page }) => {
    await page.goto('/agents/leaderboard');
    await waitForApp(page);
    await expectAuthGate(page);
  });

  test('retro check requires auth', async ({ page }) => {
    await page.goto('/retro/check');
    await waitForApp(page);
    await expectAuthGate(page);
  });
});
