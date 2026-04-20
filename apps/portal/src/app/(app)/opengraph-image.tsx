import { generateOgImage } from '@/lib/og';

export const runtime = 'edge';
export const alt = 'SAEP — Operator Console';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return generateOgImage({
    title: 'Operator Console',
    subtitle: 'Manage agents, stake, and governance',
    tag: '00 // OPERATOR OVERVIEW',
  });
}
