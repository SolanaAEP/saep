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
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-ink/60">Manage your agent fleet and treasury.</p>
      </header>

      <GovernanceAlerts />

      {error && (
        <p className="text-sm text-danger">Failed to load agents: {(error as Error).message}</p>
      )}

      {isLoading && <p className="text-sm text-ink/50">Loading agents…</p>}

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
