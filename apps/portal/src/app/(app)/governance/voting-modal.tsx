'use client';

import { useState, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useGovernanceProgram, useSendTransaction } from '@saep/sdk-ui';
import { GlitchButton } from '@saep/ui';
import type { ProposalRow, GovernanceConfigData } from './types';
import {
  categoryKey,
  CATEGORY_LABELS,
  truncateKey,
  decodeMetadataUri,
} from './types';

type VoteChoice = 'for' | 'against' | 'abstain';

interface Props {
  proposal: ProposalRow;
  config: GovernanceConfigData | null;
  onClose: () => void;
}

function ImpactSummary({ proposal, config }: { proposal: ProposalRow; config: GovernanceConfigData | null }) {
  const cat = categoryKey(proposal.category);
  const passThreshold = config ? config.passThresholdBps / 100 : 50;
  const total = proposal.forWeight + proposal.againstWeight + proposal.abstainWeight;
  const currentForPct = total > 0n ? Number((proposal.forWeight * 10000n) / total) / 100 : 0;
  const quorumBps = config?.quorumBps ?? 1000;
  const totalEligible = proposal.snapshot.totalEligibleWeight;
  const quorumTarget = (totalEligible * BigInt(quorumBps)) / 10000n;
  const quorumPct = quorumTarget > 0n ? Number((total * 100n) / quorumTarget) : 0;

  return (
    <div className="border border-ink/10 p-4 flex flex-col gap-2 bg-ink/[0.02]">
      <h4 className="text-xs font-medium text-ink/70">Economic impact</h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-ink/50">Type</span>
        <span>{CATEGORY_LABELS[cat] ?? cat}</span>
        <span className="text-ink/50">Pass threshold</span>
        <span>{passThreshold}%</span>
        <span className="text-ink/50">Current approval</span>
        <span className={currentForPct >= passThreshold ? 'text-lime' : 'text-ink'}>
          {currentForPct.toFixed(1)}%
        </span>
        <span className="text-ink/50">Quorum progress</span>
        <span className={quorumPct >= 100 ? 'text-lime' : 'text-yellow-400'}>
          {Math.min(quorumPct, 100)}%
        </span>
        <span className="text-ink/50">Target program</span>
        <span className="font-mono">{truncateKey(proposal.targetProgram)}</span>
      </div>
    </div>
  );
}

export function VotingModal({ proposal, config, onClose }: Props) {
  const { publicKey } = useWallet();
  const program = useGovernanceProgram();
  const [choice, setChoice] = useState<VoteChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stakingWeight = 0n; // wired once staking snapshot + merkle proof integration lands
  const merkleProof: number[][] = [];

  const proposalPda = proposal.address;
  const metadataStr = decodeMetadataUri(proposal.metadataUri);

  const voteRecordPda = useMemo(() => {
    if (!program || !publicKey) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vote'), proposalPda.toBuffer(), publicKey.toBuffer()],
      program.programId,
    );
    return pda;
  }, [program, publicKey, proposalPda]);

  const configPda = useMemo(() => {
    if (!program) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('governance_config')],
      program.programId,
    );
    return pda;
  }, [program]);

  const choiceArg = useMemo(() => {
    if (!choice) return null;
    const map: Record<VoteChoice, Record<string, object>> = {
      for: { for: {} },
      against: { against: {} },
      abstain: { abstain: {} },
    };
    return map[choice];
  }, [choice]);

  const { mutateAsync: sendVote, isPending } = useSendTransaction<void>({
    buildInstruction: async () => {
      if (!program || !publicKey || !choiceArg || !voteRecordPda || !configPda) {
        throw new Error('Missing program or wallet context');
      }
      return await program.methods
        .vote(choiceArg, stakingWeight, merkleProof)
        .accounts({
          proposal: proposalPda,
          voter: publicKey,
        } as any)
        .instruction();
    },
    invalidateKeys: [['governance-proposals']],
  });

  const handleVote = useCallback(async () => {
    if (!choice) return;
    setError(null);
    try {
      await sendVote();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [choice, sendVote, onClose]);

  const choices: { key: VoteChoice; label: string; color: string }[] = [
    { key: 'for', label: 'Yes', color: 'bg-lime text-black' },
    { key: 'against', label: 'No', color: 'bg-danger text-white' },
    { key: 'abstain', label: 'Abstain', color: 'bg-ink/20 text-ink' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-paper border border-ink/10 p-6 w-full max-w-lg flex flex-col gap-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vote-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 id="vote-modal-title" className="text-sm font-medium">
            Vote on Proposal #{proposal.proposalId.toString()}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-ink/50 hover:text-ink text-lg leading-none">
            &times;
          </button>
        </header>

        {metadataStr && (
          <p className="text-xs text-ink/60 break-all">
            Metadata: <span className="font-mono">{metadataStr}</span>
          </p>
        )}

        <ImpactSummary proposal={proposal} config={config} />

        <div className="flex flex-col gap-2">
          <span className="text-xs text-ink/50">
            Voting weight (SAEP staked):{' '}
            <span className="font-mono text-ink">{stakingWeight.toString()}</span>
          </span>
        </div>

        <div className="flex gap-2">
          {choices.map((c) => (
            <button
              key={c.key}
              onClick={() => setChoice(c.key)}
              className={`flex-1 text-xs font-medium py-2 transition-all border-2 ${
                choice === c.key
                  ? `${c.color} border-transparent`
                  : 'bg-transparent border-ink/15 text-ink/60 hover:border-ink/30'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-xs font-mono text-danger bg-danger/10 px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <GlitchButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlitchButton>
          <GlitchButton variant="solid" size="sm" onClick={handleVote} disabled={!choice || isPending}>{isPending ? 'Submitting...' : 'Cast vote'}</GlitchButton>
        </div>
      </div>
    </div>
  );
}
