import { expect, test } from '@playwright/test';

test.describe('staking surface', () => {
  test('renders the public mainnet staking rollout state', async ({ page }) => {
    await page.goto('/staking');

    await expect(page.getByTestId('staking-shell')).toBeVisible();
    await expect(page.getByTestId('staking-cluster-badge')).toHaveText(/mainnet-beta/i);
    await expect(page.getByTestId('staking-stage-badge')).toHaveText(/pool ready/i);
    await expect(page.getByTestId('staking-program-status')).toContainText('Deployed');
    await expect(page.getByTestId('staking-pool-status')).toContainText(/live/i);
    await expect(page.getByTestId('staking-reward-rate')).toContainText(/0$/);
    await expect(page.getByTestId('staking-rewards-status')).toContainText(/reward rate is 0/i);
    await expect(page.getByTestId('staking-rewards-banner')).toContainText(/rewards are not active yet/i);
    await expect(page.getByRole('heading', { name: /stake, lock, and track operator weight/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /select wallet/i })).toBeVisible();
    await expect(page.getByText('Loading session…')).toHaveCount(0);
  });
});
