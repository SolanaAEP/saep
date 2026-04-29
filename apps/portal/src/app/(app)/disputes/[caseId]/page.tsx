'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { GlitchButton } from '@saep/ui';
import {
  useDisputeCase,
  useDisputeConfig,
  useArbitratorAccount,
  useTallyRound,
  useEscalateAppeal,
  useResolveDispute,
  loadSalt,
  type DisputeCaseRow,
} from '@saep/sdk-ui';
import { DisputeTimeline } from '../dispute-timeline';
import { VoteResults } from '../vote-results';
import { CommitVoteModal } from '../commit-vote-modal';
import { RevealVoteModal } from '../reveal-vote-modal';
import {
  statusKey,
  verdictKey,
  truncateKey,
  fmtTs,
  fmtCountdown,
  fmtLamports,
  STATUS_COLORS,
  STATUS_LABELS,
  VERDICT_LABELS,
} from '../types';

function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function DisputeDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId ? BigInt(params.caseId) : null;
  const { publicKey } = useWallet();
  const now = useNow();

  const { data: dispute, isLoading, error } = useDisputeCase(caseId);
  const { data: config } = useDisputeConfig();

  if (isLoading) {
    return <p className="font-mono text-[11px] text-mute">Loading case…</p>;
  }

  if (error) {
    return (
      <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
        ERR: {(error as Error).message}
      </div>
    );
  }

  if (!dispute) {
    return <p className="text-xs text-ink/40">Case not found.</p>;
  }

  const status = statusKey(dispute.status);
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.requestedVrf;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            dispute // case #{dispute.caseId.toString()}
          </div>
          <h1 className="font-display text-2xl tracking-tight">
            Case #{dispute.caseId.toString()}
          </h1>
        </div>
        <span className={`text-[10px] font-mono uppercase px-2 py-1 ${colors.bg} ${colors.text}`}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <DisputeTimeline dispute={dispute} />
        <PartiesPanel dispute={dispute} />
      </div>

      <VoteResults dispute={dispute} />

      {publicKey && (
        <ArbitratorActions dispute={dispute} wallet={publicKey.toBase58()} now={now} />
      )}

      {publicKey && config && (
        <AppealSection
          dispute={dispute}
          wallet={publicKey.toBase58()}
          now={now}
          appealWindowSecs={Number(config.appealWindowSecs)}
        />
      )}

      {publicKey && (
        <CrankerActions dispute={dispute} now={now} />
      )}
    </section>
  );
}

function PartiesPanel({ dispute }: { dispute: DisputeCaseRow }) {
  const verdict = verdictKey(dispute.verdict);
  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <h2 className="font-display text-lg">Details</h2>
      <div className="space-y-0">
        {[
          ['Task', `#${dispute.taskId.toString()}`],
          ['Client', truncateKey(dispute.client)],
          ['Agent operator', truncateKey(dispute.agentOperator)],
          ['Escrow', fmtLamports(dispute.escrowAmount)],
          ['Payment mint', truncateKey(dispute.paymentMint)],
          ['Round', String(dispute.round)],
          ['Arbitrators', String(dispute.arbitratorCount)],
          ['Created', fmtTs(dispute.createdAt)],
          ...(verdict !== 'none' ? [['Verdict', VERDICT_LABELS[verdict] ?? verdict]] : []),
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between border-b border-ink/10 pb-3 pt-3 first:pt-0">
            <span className="font-mono text-[11px] text-mute">{label}</span>
            <span className="font-mono text-[13px]">{value}</span>
          </div>
        ))}
      </div>

      {dispute.arbitrators.length > 0 && (
        <div className="border-t border-ink/10 pt-3 flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute">Selected arbitrators</span>
          {dispute.arbitrators.map((a, i) => (
            <span key={i} className="font-mono text-[11px] text-ink/70">{a.toBase58()}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ArbitratorActions({ dispute, wallet, now }: { dispute: DisputeCaseRow; wallet: string; now: number }) {
  const [modal, setModal] = useState<'commit' | 'reveal' | null>(null);
  const status = statusKey(dispute.status);
  const isSelectedArbitrator = dispute.arbitrators.some((a) => a.toBase58() === wallet);

  if (!isSelectedArbitrator) return null;

  const stored = loadSalt(dispute.caseId.toString(), dispute.round, wallet);
  const canCommit = status === 'committing' && dispute.commitDeadline > now;
  const canReveal = status === 'revealing' && dispute.revealDeadline > now;

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-3">
      <h2 className="font-display text-lg">Your arbitrator actions</h2>

      {canCommit && !stored && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-mute">You need to commit your vote.</span>
          <GlitchButton variant="solid" size="sm" onClick={() => setModal('commit')}>
            Commit vote
          </GlitchButton>
        </div>
      )}

      {canCommit && stored && (
        <div className="font-mono text-[11px] text-lime">Vote committed. Waiting for reveal phase.</div>
      )}

      {canReveal && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-mute">Reveal phase is open.</span>
          <GlitchButton variant="solid" size="sm" onClick={() => setModal('reveal')}>
            Reveal vote
          </GlitchButton>
        </div>
      )}

      {status !== 'committing' && status !== 'revealing' && (
        <p className="font-mono text-[11px] text-mute">No action required in current phase.</p>
      )}

      {modal === 'commit' && (
        <CommitVoteModal dispute={dispute} onClose={() => setModal(null)} />
      )}
      {modal === 'reveal' && (
        <RevealVoteModal dispute={dispute} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function AppealSection({
  dispute,
  wallet,
  now,
  appealWindowSecs,
}: {
  dispute: DisputeCaseRow;
  wallet: string;
  now: number;
  appealWindowSecs: number;
}) {
  const appeal = useEscalateAppeal();
  const [error, setError] = useState<string | null>(null);
  const status = statusKey(dispute.status);
  if (status !== 'tallied') return null;

  const verdict = verdictKey(dispute.verdict);
  const isLoser =
    (verdict === 'agentWins' && dispute.client.toBase58() === wallet) ||
    (verdict === 'clientWins' && dispute.agentOperator.toBase58() === wallet);

  if (!isLoser) return null;

  const appealDeadline = dispute.revealDeadline + appealWindowSecs;
  const remaining = appealDeadline - now;
  if (remaining <= 0) return null;

  async function onAppeal() {
    setError(null);
    try {
      await appeal.mutateAsync({
        disputeCase: dispute.address,
        caseId: dispute.caseId,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="border border-danger/20 p-5 flex flex-col gap-3">
      <h2 className="font-display text-lg">Appeal</h2>
      <p className="font-mono text-[12px] text-ink/80 leading-relaxed">
        You lost this round. You can escalate to a larger arbitrator panel.
      </p>
      <div className="font-mono text-[11px]">
        <span className="text-mute">Window closes in </span>
        <span className="text-warning">{fmtCountdown(remaining)}</span>
      </div>
      {error && <div className="text-[11px] text-danger">{error}</div>}
      <GlitchButton
        variant="solid"
        size="sm"
        onClick={onAppeal}
        disabled={appeal.isPending}
      >
        {appeal.isPending ? 'Submitting...' : 'Escalate appeal'}
      </GlitchButton>
    </div>
  );
}

function CrankerActions({ dispute, now }: { dispute: DisputeCaseRow; now: number }) {
  const tally = useTallyRound();
  const resolve = useResolveDispute();
  const [error, setError] = useState<string | null>(null);
  const status = statusKey(dispute.status);

  const canTally = status === 'revealing' && dispute.revealDeadline <= now;
  const canResolve = status === 'tallied' || status === 'appealed';

  if (!canTally && !canResolve) return null;

  async function onTally() {
    setError(null);
    try {
      await tally.mutateAsync({ disputeCase: dispute.address });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onResolve() {
    setError(null);
    try {
      await resolve.mutateAsync({ disputeCase: dispute.address });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="border border-dashed border-ink/20 p-5 flex flex-col gap-3">
      <h2 className="font-mono text-[13px] font-medium text-mute">Crank actions</h2>
      <p className="font-mono text-[10px] text-mute">Anyone can run these to advance the dispute state.</p>
      {error && <div className="text-[11px] text-danger">{error}</div>}
      <div className="flex gap-2">
        {canTally && (
          <GlitchButton variant="outline" size="sm" onClick={onTally} disabled={tally.isPending}>
            {tally.isPending ? 'Tallying...' : 'Tally round'}
          </GlitchButton>
        )}
        {canResolve && (
          <GlitchButton variant="outline" size="sm" onClick={onResolve} disabled={resolve.isPending}>
            {resolve.isPending ? 'Resolving...' : 'Resolve dispute'}
          </GlitchButton>
        )}
      </div>
    </div>
  );
}
