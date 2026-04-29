'use client';

import { useState, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { GlitchButton } from '@saep/ui';
import {
  useRevealDisputeVote,
  loadSalt,
  deleteSalt,
  saltFromHex,
  type DisputeCaseRow,
} from '@saep/sdk-ui';
import { VERDICT_LABELS, VERDICT_BYTE } from './types';

interface Props {
  dispute: DisputeCaseRow;
  onClose: () => void;
}

function verdictEnumFromByte(b: number): Record<string, never> {
  const map: Record<number, string> = { 1: 'agentWins', 2: 'clientWins', 3: 'split' };
  const key = map[b] ?? 'none';
  return { [key]: {} } as Record<string, never>;
}

export function RevealVoteModal({ dispute, onClose }: Props) {
  const { publicKey } = useWallet();
  const reveal = useRevealDisputeVote();
  const [error, setError] = useState<string | null>(null);
  const [manualHex, setManualHex] = useState('');
  const [done, setDone] = useState(false);

  const stored = useMemo(() => {
    if (!publicKey) return null;
    return loadSalt(dispute.caseId.toString(), dispute.round, publicKey.toBase58());
  }, [publicKey, dispute.caseId, dispute.round]);

  const verdictLabel = stored
    ? VERDICT_LABELS[Object.entries(VERDICT_BYTE).find(([, v]) => v === stored.verdict)?.[0] ?? 'none'] ?? 'Unknown'
    : null;

  const onSubmit = useCallback(async () => {
    if (!publicKey) return;
    setError(null);
    try {
      let salt: Uint8Array;
      let verdictByte: number;

      if (stored) {
        salt = saltFromHex(stored.salt);
        verdictByte = stored.verdict;
      } else {
        const trimmed = manualHex.trim();
        if (trimmed.length !== 64) {
          setError('Salt must be 64 hex characters (32 bytes)');
          return;
        }
        salt = saltFromHex(trimmed);
        verdictByte = 0;
      }

      const verdict = verdictEnumFromByte(verdictByte);

      await reveal.mutateAsync({
        disputeCase: dispute.address,
        caseId: dispute.caseId,
        verdict,
        salt,
      });

      deleteSalt(dispute.caseId.toString(), dispute.round, publicKey.toBase58());
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [publicKey, stored, manualHex, dispute, reveal]);

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="bg-paper border border-ink/10 p-6 max-w-md w-full flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
          <h3 className="font-mono text-[13px] font-medium">Vote revealed</h3>
          <p className="font-mono text-[11px] text-mute">Your vote has been revealed and recorded on-chain.</p>
          <GlitchButton variant="solid" size="sm" onClick={onClose}>Done</GlitchButton>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-paper border border-ink/10 p-6 max-w-md w-full flex flex-col gap-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-mono text-[13px] font-medium">Reveal vote — Case #{dispute.caseId.toString()}</h3>

        {stored ? (
          <div className="flex flex-col gap-2">
            <div className="border border-lime/20 bg-lime/5 p-3 font-mono text-[11px] text-lime">
              Salt found in browser storage.
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px]">
              <span className="text-mute">Verdict</span>
              <span>{verdictLabel}</span>
              <span className="text-mute">Salt</span>
              <span className="truncate">{stored.salt.slice(0, 16)}...</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="border border-danger/30 bg-danger/5 p-3 font-mono text-[11px] text-danger">
              No salt found. Paste your backup salt below.
            </div>
            <input
              type="text"
              value={manualHex}
              onChange={(e) => setManualHex(e.target.value)}
              placeholder="64-char hex salt"
              className="font-mono text-[11px] bg-ink/5 border border-ink/10 px-3 py-2 focus:border-ink/30 outline-none"
            />
            <p className="font-mono text-[10px] text-mute">
              Without the correct salt, your reveal will fail on-chain (hash mismatch).
            </p>
          </div>
        )}

        {error && <div className="text-[11px] text-danger">{error}</div>}

        <div className="flex gap-2 justify-end">
          <GlitchButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlitchButton>
          <GlitchButton
            variant="solid"
            size="sm"
            onClick={onSubmit}
            disabled={reveal.isPending || (!stored && !manualHex.trim())}
          >
            {reveal.isPending ? 'Revealing...' : 'Reveal vote'}
          </GlitchButton>
        </div>
      </div>
    </div>
  );
}
