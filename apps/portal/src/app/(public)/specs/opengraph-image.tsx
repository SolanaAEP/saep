import { generateOgImage } from '@/lib/og';

export const runtime = 'edge';
export const alt = 'SAEP — Specifications';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return generateOgImage({
    title: 'Specs',
    subtitle: 'Protocol specifications and program interfaces',
    tag: '04 // TECHNICAL REFERENCE',
  });
}
