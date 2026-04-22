import { generateOgImage } from '@/lib/og';

export const runtime = 'edge';
export const alt = 'SAEP — Staking';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return generateOgImage({
    title: 'Stake SAEP',
    subtitle: 'Lock SAEP on Solana mainnet for operator weight and future governance participation.',
    tag: '08 // STAKING',
  });
}
