import type { PublicKey } from '@solana/web3.js';

export type AnchorEnum = Record<string, object>;

export const DISPUTE_STATUSES = [
  'requestedVrf',
  'selectionReady',
  'committing',
  'revealing',
  'tallied',
  'appealed',
  'resolved',
  'cancelled',
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const VERDICT_LABELS: Record<string, string> = {
  none: 'Pending',
  agentWins: 'Agent wins',
  clientWins: 'Client wins',
  split: 'Split',
};

export const VERDICT_BYTE: Record<string, number> = {
  agentWins: 1,
  clientWins: 2,
  split: 3,
};

export const STATUS_LABELS: Record<DisputeStatus, string> = {
  requestedVrf: 'VRF Requested',
  selectionReady: 'Selection Ready',
  committing: 'Committing',
  revealing: 'Revealing',
  tallied: 'Tallied',
  appealed: 'Appealed',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
};

export const STATUS_COLORS: Record<DisputeStatus, { dot: string; text: string; bg: string }> = {
  requestedVrf: { dot: 'bg-mute', text: 'text-mute', bg: 'bg-ink/5' },
  selectionReady: { dot: 'bg-mute', text: 'text-mute', bg: 'bg-ink/5' },
  committing: { dot: 'bg-info', text: 'text-info', bg: 'bg-info/10' },
  revealing: { dot: 'bg-warning', text: 'text-warning', bg: 'bg-warning/10' },
  tallied: { dot: 'bg-lime', text: 'text-lime', bg: 'bg-lime/10' },
  appealed: { dot: 'bg-danger', text: 'text-danger', bg: 'bg-danger/10' },
  resolved: { dot: 'bg-lime/60', text: 'text-ink/70', bg: 'bg-ink/5' },
  cancelled: { dot: 'bg-mute-2', text: 'text-mute', bg: 'bg-ink/5' },
};

const TERMINAL_STATUSES = new Set<string>(['resolved', 'cancelled']);

export function statusKey(status: AnchorEnum): DisputeStatus {
  return (Object.keys(status)[0] as DisputeStatus) ?? 'requestedVrf';
}

export function verdictKey(verdict: AnchorEnum): string {
  return Object.keys(verdict)[0] ?? 'none';
}

export function isTerminal(status: AnchorEnum): boolean {
  return TERMINAL_STATUSES.has(statusKey(status));
}

export function truncateKey(key: PublicKey): string {
  const s = key.toBase58();
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

export function fmtTs(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return 'Ended';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function fmtLamports(amount: bigint): string {
  const sol = Number(amount) / 1e9;
  return sol >= 0.01 ? `${sol.toFixed(2)} SOL` : `${Number(amount).toLocaleString()} lamports`;
}
