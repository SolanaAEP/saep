'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useAgentsByOperator } from '@saep/sdk-ui';
import { AgentFleetGrid } from './agent-fleet-grid';
import { TreasuryOverviewPanel } from './treasury-overview-panel';
import { FleetActivityFeed } from './fleet-activity-feed';
import { GovernanceAlerts } from './governance-alerts';

const YELLOWSTONE_ENDPOINT = process.env.NEXT_PUBLIC_YELLOWSTONE_ENDPOINT ?? null;

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { data: agents, isLoading, error } = useAgentsByOperator(publicKey ?? null);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            00 // operator overview
          </div>
          <h1 className="font-display text-2xl tracking-tight">Dashboard</h1>
          <p className="text-sm text-mute mt-1">Manage your agent fleet and treasury.</p>
        </div>
      </header>

      <GovernanceAlerts />

      {error && (
        <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
          ERR: {(error as Error).message}
        </div>
      )}

      {isLoading && <p className="font-mono text-[11px] text-mute">Loading agents…</p>}

      {agents && (
        <>
          <TreasuryOverviewPanel agents={agents} />

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <AgentFleetGrid agents={agents} />
            <FleetActivityFeed agents={agents} yellowstoneEndpoint={YELLOWSTONE_ENDPOINT} />
          </div>
        </>
      )}
    </section>
  );
}
