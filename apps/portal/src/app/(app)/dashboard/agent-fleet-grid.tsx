'use client';

import type { AgentSummary } from '@saep/sdk';
import { useTreasury } from '@saep/sdk-ui';
import { sanitize } from '@/lib/sanitize';
import { maskToTags } from './capability-tags';

const STATUS_COLOR: Record<string, string> = {
  active: 'text-lime bg-lime/10',
  paused: 'text-yellow-500 bg-yellow-500/10',
  suspended: 'text-danger bg-danger/10',
  deregistered: 'text-mute bg-mute/10',
};

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fmtSol(v: bigint): string {
  return `${(Number(v) / 1e9).toFixed(2)}`;
}

function reputationScore(agent: AgentSummary): number {
  // on-chain reputation is 0–10000 bps; display as 0–10k
  // for now derive a simple proxy from jobs completed
  return Number(agent.jobsCompleted) > 0 ? Math.min(Number(agent.jobsCompleted) * 100, 10000) : 0;
}

function AgentCard({ agent }: { agent: AgentSummary }) {
  const { data: treasury } = useTreasury(agent.did);
  const tags = maskToTags(agent.capabilityMask);
  const rep = reputationScore(agent);
  const didHex = hex(agent.did);

  return (
    <a
      href={`/agents/${didHex}`}
      className="border border-ink/10 p-5 flex flex-col gap-3 hover:border-lime/40 transition-colors"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-medium truncate text-sm">
          {sanitize(agent.manifestUri) || `Agent ${didHex.slice(0, 8)}…`}
        </h2>
        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 ${STATUS_COLOR[agent.status] ?? ''}`}>
          {agent.status}
        </span>
      </header>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 5).map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-ink/5 text-ink/70">
              {t}
            </span>
          ))}
          {tags.length > 5 && (
            <span className="text-[10px] px-1.5 py-0.5 text-ink/50">+{tags.length - 5}</span>
          )}
        </div>
      )}

      <dl className="grid grid-cols-4 gap-3 text-xs">
        <Stat label="DID" value={`${didHex.slice(0, 8)}…`} mono />
        <Stat label="Reputation" value={`${rep.toLocaleString()}`} />
        <Stat label="Stake" value={`${fmtSol(agent.stakeAmount)} SOL`} mono />
        <Stat label="Jobs (24h)" value={agent.jobsCompleted.toString()} />
      </dl>

      {treasury && (
        <div className="grid grid-cols-3 gap-3 text-xs pt-3 border-t border-ink/10">
          <Stat label="Daily limit" value={fmtSol(treasury.dailySpendLimit)} mono />
          <Stat label="Spent today" value={fmtSol(treasury.spentToday)} mono />
          <Stat label="Streaming" value={treasury.streamingActive ? 'active' : 'idle'} />
        </div>
      )}
    </a>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-ink/50">{label}</dt>
      <dd className={mono ? 'font-mono' : ''}>{value}</dd>
    </div>
  );
}

export function AgentFleetGrid({ agents }: { agents: AgentSummary[] }) {
  if (agents.length === 0) {
    return (
      <div className="border border-dashed border-ink/20 p-8 text-sm text-ink/60">
        No agents registered. <a href="/agents/register" className="underline">Register one</a>.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <AgentCard key={agent.address.toBase58()} agent={agent} />
      ))}
    </div>
  );
}
