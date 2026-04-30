'use client';

import { useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { GlitchButton } from '@saep/ui';
import {
  useLatestSnapshot,
  useStakerClaimProof,
  useClaimStakerReward,
} from '@saep/sdk-ui';

export function FeeRewards() {
  const { publicKey } = useWallet();
  const { data: snapshot } = useLatestSnapshot();
  const claim = useClaimStakerReward();
  const [error, setError] = useState<string | null>(null);
  const [claimedEpochs, setClaimedEpochs] = useState<Set<string>>(new Set());

  const epoch = snapshot?.epoch ?? null;
  const { data: claimProof } = useStakerClaimProof(epoch, publicKey ?? null);

  const claimable = useMemo(() => {
    if (!claimProof || !epoch) return null;
    if (claimedEpochs.has(epoch)) return null;
    return {
      epoch,
      amount: BigInt(claimProof.amount),
      proof: claimProof.proof,
    };
  }, [claimProof, epoch, claimedEpochs]);

  async function onClaim() {
    if (!claimable) return;
    setError(null);
    try {
      await claim.mutateAsync({
        epochId: BigInt(claimable.epoch),
        amount: claimable.amount,
        merkleProof: claimable.proof,
      });
      setClaimedEpochs((prev) => new Set(prev).add(claimable.epoch));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!publicKey) return null;

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <h2 className="font-display text-lg">Fee Rewards</h2>
      <p className="font-mono text-[11px] text-mute leading-relaxed">
        Protocol fees are distributed to stakers proportional to voting power each epoch.
      </p>

      {snapshot && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute mb-1">Current epoch</div>
            <div className="font-mono text-[15px] font-medium">{snapshot.epoch}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute mb-1">Stakers</div>
            <div className="font-mono text-[15px] font-medium">{snapshot.stakerCount}</div>
          </div>
        </div>
      )}

      {claimable ? (
        <div className="flex flex-col gap-3">
          <div className="border border-lime/20 bg-lime/5 p-3 flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute mb-1">Claimable (epoch {claimable.epoch})</div>
              <div className="font-mono text-[15px] font-medium text-lime">
                {(Number(claimable.amount) / 1e9).toFixed(4)} SAEP
              </div>
            </div>
            <GlitchButton variant="solid" size="sm" onClick={onClaim} disabled={claim.isPending}>
              {claim.isPending ? 'Claiming...' : 'Claim'}
            </GlitchButton>
          </div>
        </div>
      ) : snapshot ? (
        <div className="font-mono text-[11px] text-mute">
          No claimable rewards for current epoch.
        </div>
      ) : (
        <div className="font-mono text-[11px] text-mute">
          Snapshot oracle not available.
        </div>
      )}

      {error && <div className="font-mono text-[11px] text-danger">{error}</div>}
    </div>
  );
}
