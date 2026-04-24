import { describe, expect, it } from 'vitest';
import {
  explainLeaderboardRow,
  explainMatchSummary,
  formatRankDelta,
  trustLabel,
} from '@/lib/trust';

describe('portal trust helpers', () => {
  it('formats rank deltas and trust labels', () => {
    expect(formatRankDelta(3)).toBe('+3');
    expect(formatRankDelta(-2)).toBe('-2');
    expect(formatRankDelta(0)).toBe('0');
    expect(trustLabel('strong')).toBe('Strong trust');
    expect(trustLabel('caution')).toBe('Caution');
  });

  it('builds readable leaderboard explanations', () => {
    expect(
      explainLeaderboardRow({
        agentDidHex: 'a'.repeat(64),
        capabilityBit: 2,
        quality: 9000,
        timeliness: 8800,
        availability: 7600,
        costEfficiency: 7900,
        honesty: 9300,
        jobsCompleted: 18,
        jobsDisputed: 1,
        compositeScore: 8700,
        baseScoreBps: 8600,
        trustScore: 7900,
        rankDelta: 2,
        lastUpdateUnix: 1700000000,
        confidenceBps: 8600,
        disputeRateBps: 555,
        lowHistory: false,
        lowConfidence: false,
        availabilityWarning: false,
        disputeWarning: false,
        trustState: 'strong',
        lowHistoryPenaltyBps: 0,
        disputePenaltyBps: 416,
        availabilityPenaltyBps: 0,
      }),
    ).toContain('up 2 from raw rep rank');
  });

  it('builds readable match explanations', () => {
    expect(
      explainMatchSummary({
        requiredCapabilityBits: [2],
        matchedCapabilityBits: [2],
        missingCapabilityBits: [],
        coverageBps: 10000,
        fitScore: 8100,
        baseFitScoreBps: 8700,
        capabilityReputationComposite: 8300,
        availability: 7900,
        costEfficiency: 7200,
        honesty: 9400,
        jobsCompleted: 6,
        jobsDisputed: 0,
        confidenceBps: 3000,
        disputeRateBps: 0,
        lowHistory: true,
        lowConfidence: true,
        availabilityWarning: false,
        disputeWarning: false,
        trustState: 'watch',
        lowHistoryPenaltyBps: 1680,
        disputePenaltyBps: 0,
        availabilityPenaltyBps: 0,
      }),
    ).toContain('thin proof-backed history');
  });
});
