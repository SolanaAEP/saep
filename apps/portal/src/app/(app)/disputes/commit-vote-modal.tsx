'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { GlitchButton } from '@saep/ui';
import {
  useCommitDisputeVote,
  generateSalt,
  computeCommitHash,
  saveSalt,
  type DisputeCaseRow,
} from '@saep/sdk-ui';
import { truncateKey, VERDICT_BYTE, fmtLamports } from './types';

type Verdict = 'agentWins' | 'clientWins' | 'split';

const CHOICES: { key: Verdict; label: string; color: string }[] = [
  { key: 'agentWins', label: 'Agent wins', color: 'border-lime text-lime hover:bg-lime/10' },
  { key: 'clientWins', label: 'Client wins', color: 'border-danger text-danger hover:bg-danger/10' },
  { key: 'split', label: 'Split', color: 'border-warning text-warning hover:bg-warning/10' },
];

interface Props {
  dispute: DisputeCaseRow;
  onClose: () => void;
}

export function CommitVoteModal({ dispute, onClose }: Props) {
  const { publicKey } = useWallet();
  const commit = useCommitDisputeVote();
  const [choice, setChoice] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedSaltHex, setSavedSaltHex] = useState<string | null>(null);

  const onSubmit = useCallback(async () => {
    if (!choice || !publicKey) return;
    setError(null);
    try {
      const salt = generateSalt();
      const verdictByte = VERDICT_BYTE[choice]!;
      const hash = await computeCommitHash(verdictByte, salt);

      saveSalt(
        dispute.caseId.toString(),
        dispute.round,
        publicKey.toBase58(),
        salt,
        verdictByte,
        hash,
      );

      await commit.mutateAsync({
        disputeCase: dispute.address,
        operator: publicKey,
        caseId: dispute.caseId,
        commitHash: hash,
      });

      const hex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
      setSavedSaltHex(hex);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [choice, publicKey, dispute, commit]);

  if (savedSaltHex) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-paper border border-ink/10 p-6 max-w-md w-full flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
          <h3 className="font-mono text-[13px] font-medium">Vote committed</h3>
          <div className="border border-warning/30 bg-warning/5 p-3 font-mono text-[11px] text-warning">
            Your salt is stored in this browser. If you clear browser data before revealing, your vote is lost and you may be slashed.
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute">Salt backup (copy this)</span>
            <code
              className="text-[11px] font-mono bg-ink/5 p-2 break-all cursor-pointer hover:bg-ink/10 transition-colors"
              onClick={() => navigator.clipboard.writeText(savedSaltHex)}
              title="Click to copy"
            >
              {savedSaltHex}
            </code>
          </div>
          <GlitchButton variant="solid" size="sm" onClick={onClose}>
            Done
          </GlitchButton>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-paper border border-ink/10 p-6 max-w-md w-full flex flex-col gap-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-mono text-[13px] font-medium">Commit vote — Case #{dispute.caseId.toString()}</h3>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
          <span className="text-mute">Client</span>
          <span>{truncateKey(dispute.client)}</span>
          <span className="text-mute">Agent</span>
          <span>{truncateKey(dispute.agentOperator)}</span>
          <span className="text-mute">Escrow</span>
          <span>{fmtLamports(dispute.escrowAmount)}</span>
          <span className="text-mute">Round</span>
          <span>{dispute.round}</span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">Your verdict</span>
          <div className="flex gap-2">
            {CHOICES.map((c) => (
              <button
                key={c.key}
                onClick={() => setChoice(c.key)}
                className={`flex-1 text-xs py-2 border transition-colors ${
                  choice === c.key
                    ? `${c.color} bg-opacity-10`
                    : 'border-ink/10 text-ink/50 hover:border-ink/30'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="text-[11px] text-danger">{error}</div>}

        <div className="flex gap-2 justify-end">
          <GlitchButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlitchButton>
          <GlitchButton
            variant="solid"
            size="sm"
            onClick={onSubmit}
            disabled={!choice || commit.isPending}
          >
            {commit.isPending ? 'Submitting...' : 'Commit vote'}
          </GlitchButton>
        </div>
      </div>
    </div>
  );
}
