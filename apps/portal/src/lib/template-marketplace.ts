import { maskToTags, CAPABILITY_LABELS } from '@/app/(app)/dashboard/capability-tags';
import type { SerializedTemplate } from './template-serializer';

export type TemplateMotion = 'fresh' | 'rental' | 'forked' | 'hybrid';

export type TemplateSignalTone = 'strong' | 'watch' | 'new';

const LAMPORTS_PER_SOL = 1_000_000_000;

function normalizeUriLabel(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    const lastSegment = url.pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(lastSegment ?? url.hostname);
  } catch {
    return value;
  }
}

export function templateTitle(template: SerializedTemplate): string {
  const candidate = normalizeUriLabel(template.configUri);
  if (candidate) return candidate.length > 48 ? `${candidate.slice(0, 45)}...` : candidate;
  return `Template ${template.templateId.slice(0, 8)}`;
}

export function templateSubtitle(template: SerializedTemplate): string {
  if (template.configUri.startsWith('ipfs://')) return 'IPFS-backed config';
  if (template.configUri.startsWith('https://') || template.configUri.startsWith('http://')) {
    try {
      return new URL(template.configUri).hostname.replace(/^www\./, '');
    } catch {
      return 'Hosted config';
    }
  }
  if (template.parentTemplate) return 'Forked lineage';
  return 'On-chain template';
}

export function templateCapabilityBits(template: SerializedTemplate): number[] {
  const bits: number[] = [];
  const mask = BigInt(template.capabilityMask || '0');
  for (let i = 0; i < 32; i += 1) {
    if ((mask & (1n << BigInt(i))) !== 0n) bits.push(i);
  }
  return bits;
}

export function templateCapabilityTags(template: SerializedTemplate): string[] {
  return maskToTags(BigInt(template.capabilityMask || '0'));
}

export function templatePrimaryCapabilityBit(template: SerializedTemplate): number | null {
  return templateCapabilityBits(template)[0] ?? null;
}

export function templatePrimaryCapabilityLabel(template: SerializedTemplate): string | null {
  const bit = templatePrimaryCapabilityBit(template);
  return bit == null ? null : CAPABILITY_LABELS[bit] ?? `bit ${bit}`;
}

export function templateMotion(template: SerializedTemplate): TemplateMotion {
  const hasForks = template.forkCount > 0;
  const hasRentals = template.rentCount > 0;
  if (hasForks && hasRentals) return 'hybrid';
  if (hasRentals) return 'rental';
  if (hasForks) return 'forked';
  return 'fresh';
}

export function templateSignalTone(template: SerializedTemplate): TemplateSignalTone {
  const revenue = Number(template.totalRevenue);
  if (Number.isFinite(revenue) && revenue > 0 && template.rentCount + template.forkCount >= 2) {
    return 'strong';
  }
  if (template.rentCount > 0 || template.forkCount > 0 || template.lineageDepth > 0) {
    return 'watch';
  }
  return 'new';
}

export function templateSignalLabel(template: SerializedTemplate): string {
  const tone = templateSignalTone(template);
  if (tone === 'strong') return 'proven demand';
  if (tone === 'watch') return 'early traction';
  return 'new listing';
}

export function templateMotionLabel(template: SerializedTemplate): string {
  switch (templateMotion(template)) {
    case 'hybrid':
      return 'rent + fork';
    case 'rental':
      return 'rent-first';
    case 'forked':
      return 'fork-first';
    default:
      return 'fresh';
  }
}

export function templateBestFor(template: SerializedTemplate): string {
  const capability = templatePrimaryCapabilityLabel(template) ?? 'generalist';
  switch (templateMotion(template)) {
    case 'hybrid':
      return `Best for ${capability.toLowerCase()} teams that want both recurring rentals and a fork path.`;
    case 'rental':
      return `Best for ${capability.toLowerCase()} operators testing demand before taking on fork/setup overhead.`;
    case 'forked':
      return `Best for ${capability.toLowerCase()} builders who want to customize aggressively and keep a permanent branch.`;
    default:
      return `Best for ${capability.toLowerCase()} builders who want a clean starting point and room to shape the economics.`;
  }
}

export function templateUseCase(template: SerializedTemplate): string {
  const tags = templateCapabilityTags(template);
  if (tags.length >= 2) return `${tags[0]} + ${tags[1]}`;
  return tags[0] ?? 'General-purpose agent work';
}

export function templateFeaturedScore(template: SerializedTemplate): number {
  const revenue = Number(template.totalRevenue);
  const revenueScore = Number.isFinite(revenue) ? revenue : 0;
  return revenueScore + template.forkCount * 2_500 + template.rentCount * 2_000 - template.lineageDepth * 50;
}

export function formatTemplateBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatTemplateDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function formatTemplateRatePerDay(ratePerSec: string): string {
  const perDay = Number(ratePerSec) * 86_400;
  if (!Number.isFinite(perDay)) return 'n/a';
  if (perDay >= LAMPORTS_PER_SOL) return `${(perDay / LAMPORTS_PER_SOL).toFixed(2)} SOL/day`;
  return `${perDay.toLocaleString()} units/day`;
}

export function formatTemplateRevenue(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  if (num >= LAMPORTS_PER_SOL) return `${(num / LAMPORTS_PER_SOL).toFixed(2)} SOL`;
  return num.toLocaleString();
}

export function templateMarketplaceHref(template: SerializedTemplate): string | null {
  const bit = templatePrimaryCapabilityBit(template);
  return bit == null ? null : `/marketplace?capability=${bit}`;
}

export function templateLeaderboardHref(template: SerializedTemplate): string | null {
  const bit = templatePrimaryCapabilityBit(template);
  return bit == null ? null : `/agents/leaderboard?capability=${bit}`;
}
