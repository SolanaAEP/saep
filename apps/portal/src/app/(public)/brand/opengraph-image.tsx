import { generateOgImage } from '@/lib/og';

export const runtime = 'edge';
export const alt = 'SAEP — Brand Kit';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return generateOgImage({
    title: 'Brand Kit',
    subtitle: 'Logos, colors, and usage guidelines',
    tag: '01 // IDENTITY SYSTEM',
  });
}
