import type {
  DiscoveryAgentMatchSummary,
  DiscoveryTaskMatchSummary,
  LeaderboardRow,
} from '@saep/sdk-ui';

export type TrustState = 'strong' | 'watch' | 'caution';

type TrustSignalsLike = {
  confidenceBps: number;
  disputeRateBps: number;
  lowHistory: boolean;
  lowConfidence: boolean;
  availabilityWarning: boolean;
  disputeWarning: boolean;
  trustState: TrustState;
  lowHistoryPenaltyBps: number;
  disputePenaltyBps: number;
  availabilityPenaltyBps: number;
};

export function toPct(value: number | null | undefined, max = 10_000): string {
  if (value == null) return 'n/a';
  return `${Math.round((Math.max(0, Math.min(value, max)) / max) * 100)}%`;
}

export function trustTone(state: TrustState | null | undefined): string {
  switch (state) {
    case 'strong':
      return 'border-lime/30 bg-lime/10 text-lime';
    case 'caution':
      return 'border-danger/30 bg-danger/10 text-danger';
    default:
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
  }
}

export function trustLabel(state: TrustState | null | undefined): string {
  switch (state) {
    case 'strong':
      return 'Strong trust';
    case 'caution':
      return 'Caution';
    default:
      return 'Watch';
  }
}

export function confidenceLabel(confidenceBps: number): string {
  if (confidenceBps >= 8_000) return 'established history';
  if (confidenceBps >= 5_000) return 'growing history';
  return 'thin history';
}

export function summarizeTrustSignals(signals: TrustSignalsLike): string[] {
  const parts = [`confidence ${toPct(signals.confidenceBps)}`];
  if (signals.availabilityWarning) {
    parts.push(`availability drag ${toPct(signals.availabilityPenaltyBps)}`);
  }
  if (signals.disputeWarning) {
    parts.push(`dispute pressure ${toPct(signals.disputeRateBps)}`);
  }
  if (signals.lowHistory) {
    parts.push('thin proof-backed history');
  } else if (signals.lowConfidence) {
    parts.push('history still stabilizing');
  }
  return parts;
}

export function explainMatchSummary(
  summary: DiscoveryAgentMatchSummary | DiscoveryTaskMatchSummary,
): string {
  const parts = [
    `${Math.round(summary.coverageBps / 100)}% capability coverage`,
    `fit ${toPct(summary.fitScore)}`,
  ];
  if (summary.capabilityReputationComposite != null) {
    parts.push(`cap rep ${toPct(summary.capabilityReputationComposite)}`);
  }
  if (summary.honesty != null) {
    parts.push(`honesty ${toPct(summary.honesty)}`);
  }
  parts.push(...summarizeTrustSignals(summary));
  return parts.join(' • ');
}

export function explainLeaderboardRow(row: LeaderboardRow): string {
  const parts = [
    `trust ${toPct(row.trustScore)}`,
    `composite ${toPct(row.compositeScore)}`,
    ...summarizeTrustSignals(row),
  ];
  if (row.rankDelta > 0) {
    parts.push(`up ${row.rankDelta} from raw rep rank`);
  } else if (row.rankDelta < 0) {
    parts.push(`down ${Math.abs(row.rankDelta)} after trust penalties`);
  }
  return parts.join(' • ');
}

export function formatRankDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return '0';
}
