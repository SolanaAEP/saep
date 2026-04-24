import { describe, expect, it } from 'vitest';
import type { SerializedTemplate } from '@/lib/template-serializer';
import {
  formatTemplateRatePerDay,
  templateBestFor,
  templateLeaderboardHref,
  templateMarketplaceHref,
  templateMotion,
  templateMotionLabel,
  templatePrimaryCapabilityLabel,
  templateSignalLabel,
  templateTitle,
} from '@/lib/template-marketplace';

const baseTemplate: SerializedTemplate = {
  address: '11111111111111111111111111111111',
  templateId: 'a'.repeat(64),
  author: '22222222222222222222222222222222',
  configHash: 'b'.repeat(64),
  configUri: 'https://example.com/templates/code-review.json',
  capabilityMask: (1n << 2n).toString(),
  royaltyBps: 500,
  parentTemplate: null,
  lineageDepth: 0,
  forkCount: 0,
  rentCount: 0,
  totalRevenue: '0',
  rentPricePerSec: '10000',
  minRentDuration: 86_400,
  maxRentDuration: 604_800,
  status: 'published',
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};

describe('template marketplace helpers', () => {
  it('builds readable titles and capability links', () => {
    expect(templateTitle(baseTemplate)).toBe('code-review.json');
    expect(templatePrimaryCapabilityLabel(baseTemplate)).toBe('Code Gen');
    expect(templateMarketplaceHref(baseTemplate)).toBe('/marketplace?capability=2');
    expect(templateLeaderboardHref(baseTemplate)).toBe('/agents/leaderboard?capability=2');
  });

  it('classifies fresh, rental, forked, and hybrid motion', () => {
    expect(templateMotion(baseTemplate)).toBe('fresh');
    expect(templateMotionLabel(baseTemplate)).toBe('fresh');
    expect(templateSignalLabel(baseTemplate)).toBe('new listing');

    const rentalTemplate = { ...baseTemplate, rentCount: 3 };
    expect(templateMotion(rentalTemplate)).toBe('rental');
    expect(templateBestFor(rentalTemplate)).toContain('testing demand');

    const forkedTemplate = { ...baseTemplate, forkCount: 2 };
    expect(templateMotion(forkedTemplate)).toBe('forked');

    const hybridTemplate = {
      ...baseTemplate,
      forkCount: 3,
      rentCount: 4,
      totalRevenue: '4200000000',
    };
    expect(templateMotion(hybridTemplate)).toBe('hybrid');
    expect(templateSignalLabel(hybridTemplate)).toBe('proven demand');
  });

  it('formats daily rent consistently', () => {
    expect(formatTemplateRatePerDay('200000')).toContain('SOL/day');
  });
});
