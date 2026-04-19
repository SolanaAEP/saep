import type { PublicKey } from '@solana/web3.js';

// Anchor decodes Rust enums as `{ variantName: {} }`. Once @saep/sdk is rebuilt,
// import `AnchorEnum` from there instead.
export type AnchorEnum<K extends string = string> = { [key in K]?: Record<string, never> };

export interface ProposalRow {
  address: PublicKey;
  proposalId: bigint;
  proposer: PublicKey;
  category: AnchorEnum;
  targetProgram: PublicKey;
  metadataUri: Uint8Array;
  status: AnchorEnum;
  createdAt: number;
  voteStart: number;
  voteEnd: number;
  forWeight: bigint;
  againstWeight: bigint;
  abstainWeight: bigint;
  snapshot: {
    totalEligibleWeight: bigint;
    snapshotSlot: bigint;
    snapshotRoot: Uint8Array;
  };
}

export interface GovernanceConfigData {
  authority: PublicKey;
  nxsStaking: PublicKey;
  capabilityRegistry: PublicKey;
  feeCollector: PublicKey;
  emergencyCouncil: PublicKey;
  minProposerStake: bigint;
  proposerCollateral: bigint;
  voteWindowSecsStandard: bigint;
  voteWindowSecsEmergency: bigint;
  voteWindowSecsMeta: bigint;
  quorumBps: number;
  passThresholdBps: number;
  metaPassThresholdBps: number;
  timelockSecsStandard: bigint;
  timelockSecsCritical: bigint;
  timelockSecsMeta: bigint;
  minLockToVoteSecs: bigint;
  devModeTimelockOverrideSecs: bigint;
  nextProposalId: bigint;
  nextEmergencyId: bigint;
  paused: boolean;
  bump: number;
}

export const PROPOSAL_CATEGORIES = [
  'ParameterChange',
  'ProgramUpgrade',
  'TreasurySpend',
  'EmergencyPause',
  'CapabilityTagUpdate',
  'Meta',
] as const;

export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProposalCategory, string> = {
  ParameterChange: 'Fee change',
  ProgramUpgrade: 'Program upgrade',
  TreasurySpend: 'Treasury grant',
  EmergencyPause: 'Emergency pause',
  CapabilityTagUpdate: 'Capability addition',
  Meta: 'Meta / governance',
};

export const FILTER_TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'ParameterChange', label: 'Fee change' },
  { value: 'CapabilityTagUpdate', label: 'Capability addition' },
  { value: 'TreasurySpend', label: 'Treasury grant' },
  { value: 'Meta', label: 'Slashing parameter' },
] as const;

export function categoryKey(cat: AnchorEnum): ProposalCategory {
  return (Object.keys(cat)[0] as ProposalCategory) ?? 'ParameterChange';
}

export function statusKey(status: AnchorEnum): string {
  return Object.keys(status)[0]?.toLowerCase() ?? 'unknown';
}

export function statusLabel(status: AnchorEnum): string {
  const key = statusKey(status);
  const labels: Record<string, string> = {
    voting: 'Voting',
    passed: 'Passed',
    rejected: 'Rejected',
    queued: 'Queued',
    executed: 'Executed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    expired: 'Expired',
  };
  return labels[key] ?? key;
}

export function statusColor(status: AnchorEnum): string {
  const key = statusKey(status);
  const colors: Record<string, string> = {
    voting: 'text-lime/70',
    passed: 'text-lime',
    rejected: 'text-danger',
    queued: 'text-yellow-400',
    executed: 'text-lime',
    failed: 'text-danger',
    cancelled: 'text-ink/40',
    expired: 'text-ink/40',
  };
  return colors[key] ?? 'text-ink/50';
}

export function truncateKey(key: PublicKey): string {
  const s = key.toBase58();
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function decodeMetadataUri(raw: Uint8Array): string {
  return new TextDecoder().decode(raw).replace(/\0+$/, '');
}
