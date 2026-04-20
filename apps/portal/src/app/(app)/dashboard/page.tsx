'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useAgentsByOperator, useTokenBalance, useTokenPrice } from '@saep/sdk-ui';
import { PublicKey } from '@solana/web3.js';
import { AgentFleetGrid } from './agent-fleet-grid';
import { TreasuryOverviewPanel } from './treasury-overview-panel';
import { FleetActivityFeed } from './fleet-activity-feed';
import { GovernanceAlerts } from './governance-alerts';
import { BuybackStats } from './buyback-stats';

const YELLOWSTONE_ENDPOINT = process.env.NEXT_PUBLIC_YELLOWSTONE_ENDPOINT ?? null;
const SAEP_MINT = process.env.NEXT_PUBLIC_SAEP_MINT
  ? new PublicKey(process.env.NEXT_PUBLIC_SAEP_MINT)
  : null;

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { data: agents, isLoading, error } = useAgentsByOperator(publicKey ?? null);
  const { data: tokenBalance } = useTokenBalance(publicKey ?? null, SAEP_MINT);
  const { data: tokenPrice } = useTokenPrice(SAEP_MINT?.toBase58() ?? null);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            00 // operator overview
          </div>
          <h1 className="font-display text-2xl tracking-tight">Dashboard</h1>
          <p className="text-sm text-mute mt-1">Manage your agent fleet and treasury.</p>
        </div>
      </header>

      {SAEP_MINT && (
        <div className="flex items-center gap-6 font-mono text-[11px] text-mute border border-ink/10 bg-paper px-4 py-3">
          {tokenPrice && (
            <span>
              <span className="text-[10px] tracking-wider uppercase mr-1.5">Price</span>
              <span className="text-ink">${tokenPrice.price.toFixed(6)}</span>
            </span>
          )}
          {tokenBalance && (
            <span>
              <span className="text-[10px] tracking-wider uppercase mr-1.5">Balance</span>
              <span className="text-ink">{tokenBalance.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} SAEP</span>
            </span>
          )}
          <a
            href={`https://jup.ag/swap/SOL-${SAEP_MINT.toBase58()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lime hover:underline text-[10px] uppercase tracking-widest ml-auto"
          >
            Buy SAEP →
          </a>
        </div>
      )}

      <BuybackStats />
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

          <div className={`grid gap-6 ${YELLOWSTONE_ENDPOINT ? 'lg:grid-cols-[1fr_320px]' : ''}`}>
            <AgentFleetGrid agents={agents} />
            {YELLOWSTONE_ENDPOINT && (
              <FleetActivityFeed agents={agents} yellowstoneEndpoint={YELLOWSTONE_ENDPOINT} />
            )}
          </div>
        </>
      )}
    </section>
  );
}
