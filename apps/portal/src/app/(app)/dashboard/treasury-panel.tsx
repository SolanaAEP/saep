'use client';

import { useTreasury } from '@saep/sdk-ui';

export function TreasuryPanel({ did }: { did: Uint8Array }) {
  const { data, isLoading } = useTreasury(did);
  if (isLoading) return <div className="text-xs text-ink/50">Loading treasury…</div>;
  if (!data) {
    return <div className="text-xs text-ink/50">No treasury initialized.</div>;
  }
  return (
    <div className="grid grid-cols-3 gap-4 text-xs pt-3 border-t border-ink/10">
      <Stat label="Daily limit" value={fmtLamports(data.dailySpendLimit)} />
      <Stat label="Spent today" value={fmtLamports(data.spentToday)} />
      <Stat label="Streaming" value={data.streamingActive ? 'active' : 'idle'} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-ink/50">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function fmtLamports(v: bigint): string {
  return `${(Number(v) / 1e9).toFixed(4)}`;
}
