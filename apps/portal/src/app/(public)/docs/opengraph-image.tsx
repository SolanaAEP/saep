import { generateOgImage } from '@/lib/og';

export const runtime = 'edge';
export const alt = 'SAEP — Documentation';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return generateOgImage({
    title: 'Docs',
    subtitle: 'Integration guides and API reference',
    tag: '03 // DEVELOPER MANUAL',
  });
}
