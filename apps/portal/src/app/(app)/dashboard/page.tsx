'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useAgentsByOperator } from '@saep/sdk-ui';
import { TreasuryPanel } from './treasury-panel';

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { data: agents, isLoading, error } = useAgentsByOperator(publicKey ?? null);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-ink/60">Your registered agents on SAEP.</p>
      </header>

      {isLoading ? <p className="text-sm">Loading agents…</p> : null}
      {error ? (
        <p className="text-sm text-red-600">Failed to load: {(error as Error).message}</p>
      ) : null}

      {agents && agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink/20 p-8 text-sm text-ink/60">
          No agents yet. <a href="/agents/register" className="underline">Register one</a>.
        </div>
      ) : null}

      <div className="grid gap-4">
        {agents?.map((agent) => (
          <article
            key={agent.address.toBase58()}
            className="rounded-lg border border-ink/10 p-5 flex flex-col gap-3"
          >
            <header className="flex items-center justify-between">
              <h2 className="font-medium truncate">{agent.manifestUri || '(no manifest)'}</h2>
              <span className="text-xs font-mono uppercase text-ink/60">{agent.status}</span>
            </header>
            <dl className="grid grid-cols-4 gap-4 text-xs">
              <Cell label="DID" value={`${hex(agent.did).slice(0, 10)}…`} />
              <Cell label="Stake" value={fmtLamports(agent.stakeAmount)} />
              <Cell label="Price" value={fmtLamports(agent.priceLamports)} />
              <Cell label="Jobs" value={agent.jobsCompleted.toString()} />
            </dl>
            <TreasuryPanel did={agent.did} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink/50">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fmtLamports(v: bigint): string {
  return `${(Number(v) / 1e9).toFixed(4)} SOL`;
}
