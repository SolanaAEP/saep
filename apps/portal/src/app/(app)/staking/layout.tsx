import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Staking',
  description:
    'Stake SAEP on Solana mainnet for operator weight and future governance participation.',
  openGraph: {
    title: 'Stake SAEP',
    description:
      'Stake SAEP on Solana mainnet for operator weight and future governance participation.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Stake SAEP',
    description:
      'Stake SAEP on Solana mainnet for operator weight and future governance participation.',
  },
};

export default function StakingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
