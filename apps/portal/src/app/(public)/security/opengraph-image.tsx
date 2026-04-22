import { generateOgImage } from '@/lib/og';

export const runtime = 'edge';
export const alt = 'SAEP — Security';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return generateOgImage({
    title: 'Security',
    subtitle: 'Disclosure policy, bug bounty, and threat model',
    tag: '02 // TRUST INFRASTRUCTURE',
  });
}
