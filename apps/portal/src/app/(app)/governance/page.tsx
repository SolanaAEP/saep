'use client';

import { useState, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useGovernanceProgram } from '@saep/sdk-ui';
import { useQuery } from '@tanstack/react-query';
import { PublicKey } from '@solana/web3.js';
import { ActiveProposalsGrid } from './proposals-grid';
import { VotingModal } from './voting-modal';
import { ProposalHistory } from './proposal-history';
import { CreateProposalForm } from './create-proposal-form';
import type { ProposalRow, GovernanceConfigData } from './types';

const GOVERNANCE_CONFIG_SEED = Buffer.from('governance_config');

type Tab = 'active' | 'history' | 'create';

function useGovernanceConfig() {
  const program = useGovernanceProgram();
  const programId = program?.programId ?? null;

  const configPda = useMemo(() => {
    if (!programId) return null;
    const [pda] = PublicKey.findProgramAddressSync([GOVERNANCE_CONFIG_SEED], programId);
    return pda;
  }, [programId]);

  return useQuery({
    queryKey: ['governance-config', configPda?.toBase58()],
    enabled: Boolean(program && configPda),
    staleTime: 30_000,
    queryFn: async () => {
      const account = program!.account as Record<string, { fetchNullable: (addr: PublicKey) => Promise<unknown> }>;
      const accessor = account['governanceConfig'] ?? account['GovernanceConfig'];
      if (!accessor) return null;
      return (await accessor.fetchNullable(configPda!)) as GovernanceConfigData | null;
    },
  });
}

function useAllProposals() {
  const program = useGovernanceProgram();
  const programId = program?.programId.toBase58() ?? null;

  return useQuery({
    queryKey: ['governance-proposals', programId],
    enabled: Boolean(program),
    staleTime: 15_000,
    queryFn: async () => {
      const account = program!.account as Record<string, { all: () => Promise<Array<{ publicKey: PublicKey; account: Record<string, unknown> }>> }>;
      const accessor = account['proposalAccount'] ?? account['ProposalAccount'];
      if (!accessor) return [];
      const raw = await accessor.all();
      return raw.map((r): ProposalRow => ({
        address: r.publicKey,
        proposalId: r.account.proposalId as bigint,
        proposer: r.account.proposer as PublicKey,
        category: r.account.category as Record<string, unknown>,
        targetProgram: r.account.targetProgram as PublicKey,
        metadataUri: r.account.metadataUri as Uint8Array,
        status: r.account.status as Record<string, unknown>,
        createdAt: Number(r.account.createdAt as bigint),
        voteStart: Number(r.account.voteStart as bigint),
        voteEnd: Number(r.account.voteEnd as bigint),
        forWeight: r.account.forWeight as bigint,
        againstWeight: r.account.againstWeight as bigint,
        abstainWeight: r.account.abstainWeight as bigint,
        snapshot: r.account.snapshot as { totalEligibleWeight: bigint; snapshotSlot: bigint; snapshotRoot: Uint8Array },
      }));
    },
  });
}

export default function GovernancePage() {
  const { publicKey } = useWallet();
  const [tab, setTab] = useState<Tab>('active');
  const [voteTarget, setVoteTarget] = useState<ProposalRow | null>(null);

  const { data: config } = useGovernanceConfig();
  const { data: proposals, isLoading, error } = useAllProposals();

  const now = Math.floor(Date.now() / 1000);

  const activeProposals = useMemo(
    () => proposals?.filter((p) => statusKey(p.status) === 'voting' && p.voteEnd > now) ?? [],
    [proposals, now],
  );

  const pastProposals = useMemo(
    () => proposals?.filter((p) => statusKey(p.status) !== 'voting' || p.voteEnd <= now) ?? [],
    [proposals, now],
  );

  const handleVote = useCallback((proposal: ProposalRow) => {
    setVoteTarget(proposal);
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: `Active (${activeProposals.length})` },
    { key: 'history', label: 'History' },
    { key: 'create', label: 'New proposal' },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Governance</h1>
        <p className="text-sm text-ink/60">
          Vote on proposals, track outcomes, and shape protocol parameters.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-ink/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-lime text-ink font-medium'
                : 'border-transparent text-ink/50 hover:text-ink/80'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="text-sm text-danger">Failed to load proposals: {(error as Error).message}</p>
      )}

      {isLoading && <p className="text-sm text-ink/50">Loading proposals...</p>}

      {tab === 'active' && (
        <ActiveProposalsGrid
          proposals={activeProposals}
          config={config ?? null}
          onVote={handleVote}
          walletConnected={Boolean(publicKey)}
        />
      )}

      {tab === 'history' && <ProposalHistory proposals={pastProposals} />}

      {tab === 'create' && (
        <CreateProposalForm config={config ?? null} walletConnected={Boolean(publicKey)} />
      )}

      {voteTarget && (
        <VotingModal
          proposal={voteTarget}
          config={config ?? null}
          onClose={() => setVoteTarget(null)}
        />
      )}
    </section>
  );
}

function statusKey(status: Record<string, unknown>): string {
  return Object.keys(status)[0]?.toLowerCase() ?? 'unknown';
}
