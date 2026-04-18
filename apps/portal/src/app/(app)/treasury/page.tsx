'use client';

import { useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAgentsByOperator } from '@saep/sdk-ui';
import type { AgentSummary } from '@saep/sdk';
import { MultiAssetBalanceTable } from './multi-asset-balance-table';
import { StreamingPaymentsMonitor } from './streaming-payments-monitor';
import { SpendingLimitsEditor } from './spending-limits-editor';
import { ExportReports } from './export-reports';

export default function TreasuryPage() {
  const { publicKey } = useWallet();
  const { data: agents, isLoading, error } = useAgentsByOperator(publicKey ?? null);
  const [selected, setSelected] = useState<string | null>(null);

  const active = useMemo(() => {
    if (!agents || agents.length === 0) return null;
    return agents.find((a) => didHex(a.did) === selected) ?? agents[0];
  }, [agents, selected]);

  if (isLoading) return <p className="font-mono text-[11px] text-mute">Loading treasuries…</p>;
  if (error) return <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">ERR: {(error as Error).message}</div>;

  if (!agents || agents.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <header className="border-b border-ink/10 pb-6">
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            02 // treasury management
          </div>
          <h1 className="font-display text-2xl tracking-tight">Treasury</h1>
          <p className="text-sm text-mute mt-1">
            No agents registered yet. Register an agent first to manage its treasury.
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6 max-w-5xl">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            02 // treasury management
          </div>
          <h1 className="font-display text-2xl tracking-tight">Treasury</h1>
          <p className="text-sm text-mute mt-1">Multi-asset balances, streams, and spend controls.</p>
        </div>
      </header>

      <AgentSelector agents={agents} activeDid={active ? didHex(active.did) : null} onSelect={setSelected} />

      {active && (
        <>
          <MultiAssetBalanceTable agent={active} />
          <StreamingPaymentsMonitor agent={active} />
          <SpendingLimitsEditor agent={active} />
          <ExportReports agent={active} />
        </>
      )}
    </section>
  );
}

function AgentSelector({
  agents,
  activeDid,
  onSelect,
}: {
  agents: AgentSummary[];
  activeDid: string | null;
  onSelect: (did: string) => void;
}) {
  if (agents.length === 1) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {agents.map((a) => {
        const hex = didHex(a.did);
        const isActive = hex === activeDid;
        return (
          <button
            key={hex}
            onClick={() => onSelect(hex)}
            className={`font-mono text-[11px] px-3 py-1.5 border transition-colors ${
              isActive
                ? 'bg-lime/5 border-lime text-lime'
                : 'border-ink/10 text-mute hover:border-ink/30 hover:text-ink'
            }`}
          >
            {hex.slice(0, 12)}…
          </button>
        );
      })}
    </div>
  );
}

function didHex(d: Uint8Array): string {
  return Array.from(d).map((x) => x.toString(16).padStart(2, '0')).join('');
}
