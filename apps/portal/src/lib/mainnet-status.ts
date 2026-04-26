import type { SaepCluster } from '@saep/sdk';

export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const MAINNET_SAEP_MINT = 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump';

export const mainnetTaskFlowStatus = {
  cluster: 'mainnet-beta' as const,
  headline: 'Task market is live on Solana mainnet.',
  summary:
    'The task market is live, MarketGlobal is initialized, USDC and SAEP are enabled for payments, and the first funded escrow is complete.',
  facts: [
    ['Task market', 'Live'],
    ['MarketGlobal', 'Initialized'],
    ['Payment mints', 'USDC + SAEP'],
    ['Public write path', 'Quick Hire'],
  ],
  mints: [
    { symbol: 'USDC', address: MAINNET_USDC_MINT, decimals: 6, suggestedAmount: '1' },
    { symbol: 'SAEP', address: MAINNET_SAEP_MINT, decimals: 6, suggestedAmount: '100' },
  ],
};

export function solanaExplorerTxUrl(signature: string, cluster: SaepCluster | string) {
  const base = `https://explorer.solana.com/tx/${signature}`;
  if (cluster === 'mainnet-beta') return base;
  if (cluster === 'devnet') return `${base}?cluster=devnet`;
  if (cluster === 'localnet') return `${base}?cluster=custom`;
  return base;
}
