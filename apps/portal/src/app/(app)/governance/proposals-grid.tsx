'use client';

import { GlitchButton } from '@saep/ui';
import {
  type ProposalRow,
  type GovernanceConfigData,
  categoryKey,
  CATEGORY_LABELS,
  truncateKey,
} from './types';

interface Props {
  proposals: ProposalRow[];
  config: GovernanceConfigData | null;
  onVote: (proposal: ProposalRow) => void;
  walletConnected: boolean;
}

function timeRemaining(voteEnd: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = voteEnd - now;
  if (diff <= 0) return 'Ended';
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function QuorumBar({ proposal, config }: { proposal: ProposalRow; config: GovernanceConfigData | null }) {
  const totalVoted = proposal.forWeight + proposal.againstWeight + proposal.abstainWeight;
  const totalEligible = proposal.snapshot.totalEligibleWeight;
  const quorumBps = config?.quorumBps ?? 1000;
  const quorumTarget = (totalEligible * BigInt(quorumBps)) / 10000n;
  const pct = quorumTarget > 0n ? Number((totalVoted * 100n) / quorumTarget) : 0;
  const clamped = Math.min(pct, 100);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[10px] text-ink/50">
        <span>Quorum</span>
        <span>{Math.min(pct, 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-lime transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function VoteTally({ proposal }: { proposal: ProposalRow }) {
  const total = proposal.forWeight + proposal.againstWeight + proposal.abstainWeight;
  if (total === 0n) {
    return <p className="text-xs text-ink/40">No votes yet</p>;
  }

  const pctFor = Number((proposal.forWeight * 100n) / total);
  const pctAgainst = Number((proposal.againstWeight * 100n) / total);
  const pctAbstain = 100 - pctFor - pctAgainst;

  return (
    <div className="flex gap-3 text-xs">
      <span className="text-lime">Yes {pctFor}%</span>
      <span className="text-danger">No {pctAgainst}%</span>
      <span className="text-ink/50">Abstain {pctAbstain}%</span>
    </div>
  );
}

export function ActiveProposalsGrid({ proposals, config, onVote, walletConnected }: Props) {
  if (proposals.length === 0) {
    return (
      <div className="border border-ink/10 p-8 text-center">
        <p className="text-sm text-ink/50">No active proposals</p>
        <p className="text-xs text-ink/30 mt-1">Create one to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {proposals.map((p) => {
        const cat = categoryKey(p.category);
        return (
          <div
            key={p.address.toBase58()}
            className="border border-ink/10 p-5 flex flex-col gap-3 bg-ink/[0.02] hover:border-ink/20 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-ink/40 font-medium">
                  {CATEGORY_LABELS[cat] ?? cat}
                </span>
                <h3 className="text-sm font-medium leading-tight">
                  Proposal #{p.proposalId.toString()}
                </h3>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-lime">
                {timeRemaining(p.voteEnd)}
              </span>
            </div>

            <p className="text-xs text-ink/50">
              Proposer: <span className="font-mono">{truncateKey(p.proposer)}</span>
            </p>

            <p className="text-xs text-ink/50">
              Target: <span className="font-mono">{truncateKey(p.targetProgram)}</span>
            </p>

            <VoteTally proposal={p} />
            <QuorumBar proposal={p} config={config} />

            <GlitchButton variant="solid" size="sm" onClick={() => onVote(p)} disabled={!walletConnected} className="mt-auto">{walletConnected ? 'Vote' : 'Connect wallet to vote'}</GlitchButton>
          </div>
        );
      })}
    </div>
  );
}
