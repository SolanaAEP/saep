'use client';

import { useState, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  useAllDisputeCases,
  useArbitratorAccount,
  listPendingSalts,
  type DisputeCaseRow,
} from '@saep/sdk-ui';
import { DisputeCard } from './dispute-card';
import { statusKey, isTerminal } from './types';

type Tab = 'active' | 'mine' | 'arbitrator';

export default function DisputesPage() {
  const { publicKey } = useWallet();
  const [tab, setTab] = useState<Tab>('active');
  const { data: disputes, isLoading, error } = useAllDisputeCases();
  const { data: arbitrator } = useArbitratorAccount(publicKey ?? null);

  const activeCases = useMemo(
    () => disputes?.filter((d) => !isTerminal(d.status)) ?? [],
    [disputes],
  );

  const myCases = useMemo(() => {
    if (!publicKey || !disputes) return [];
    const wallet = publicKey.toBase58();
    return disputes.filter(
      (d) =>
        d.client.toBase58() === wallet ||
        d.agentOperator.toBase58() === wallet ||
        d.arbitrators.some((a) => a.toBase58() === wallet),
    );
  }, [disputes, publicKey]);

  const pendingSalts = useMemo(() => {
    if (!publicKey) return [];
    try {
      return listPendingSalts(publicKey.toBase58());
    } catch {
      return [];
    }
  }, [publicKey]);

  const pendingCaseIds = useMemo(
    () => new Set(pendingSalts.map((s) => s.caseId)),
    [pendingSalts],
  );

  const arbCases = useMemo(() => {
    if (!publicKey || !disputes) return [];
    const wallet = publicKey.toBase58();
    return disputes.filter((d) => d.arbitrators.some((a) => a.toBase58() === wallet));
  }, [disputes, publicKey]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: `Active (${activeCases.length})` },
    { key: 'mine', label: `My cases (${myCases.length})` },
    { key: 'arbitrator', label: 'Arbitrator' },
  ];

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            06 // dispute resolution
          </div>
          <h1 className="font-display text-2xl tracking-tight">Disputes</h1>
          <p className="text-sm text-mute mt-1">
            Browse active disputes, arbitrate cases, and track resolutions.
          </p>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-ink/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`font-mono text-[11px] uppercase px-3 py-2 transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-lime text-lime'
                : 'border-transparent text-mute hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">
          ERR: {(error as Error).message}
        </div>
      )}

      {isLoading && <p className="font-mono text-[11px] text-mute">Loading disputes…</p>}

      {tab === 'active' && (
        <CaseGrid disputes={activeCases} empty="No active disputes." />
      )}

      {tab === 'mine' && (
        publicKey ? (
          <CaseGrid disputes={myCases} empty="You're not involved in any disputes." />
        ) : (
          <p className="font-mono text-[11px] text-mute">Connect wallet to see your cases.</p>
        )
      )}

      {tab === 'arbitrator' && (
        <ArbitratorTab
          arbitrator={arbitrator}
          cases={arbCases}
          pendingCaseIds={pendingCaseIds}
          walletConnected={Boolean(publicKey)}
        />
      )}
    </section>
  );
}

function CaseGrid({ disputes, empty }: { disputes: DisputeCaseRow[]; empty: string }) {
  if (disputes.length === 0) {
    return <p className="font-mono text-[11px] text-mute">{empty}</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {disputes.map((d) => (
        <DisputeCard key={d.caseId.toString()} dispute={d} />
      ))}
    </div>
  );
}

function ArbitratorTab({
  arbitrator,
  cases,
  pendingCaseIds,
  walletConnected,
}: {
  arbitrator: { effectiveStake: bigint; badFaithStrikes: number; casesParticipated: number; status: Record<string, object> } | null | undefined;
  cases: DisputeCaseRow[];
  pendingCaseIds: Set<string>;
  walletConnected: boolean;
}) {
  if (!walletConnected) {
    return <p className="font-mono text-[11px] text-mute">Connect wallet to view arbitrator status.</p>;
  }

  if (!arbitrator) {
    return (
      <div className="border border-dashed border-ink/20 p-5 flex flex-col gap-3">
        <h3 className="font-mono text-[13px] font-medium">Not registered</h3>
        <p className="font-mono text-[11px] text-mute leading-relaxed">
          You need an active staking position to register as an arbitrator. Registration happens through the staking interface.
        </p>
      </div>
    );
  }

  const statusStr = Object.keys(arbitrator.status)[0] ?? 'unknown';
  const needsReveal = cases.filter((c) => {
    const s = statusKey(c.status);
    return s === 'revealing' && pendingCaseIds.has(c.caseId.toString());
  });

  const needsCommit = cases.filter((c) => statusKey(c.status) === 'committing');

  return (
    <div className="flex flex-col gap-6">
      <div className="border border-ink/10 p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute mb-1">Status</div>
            <div className="font-mono text-[15px] font-medium capitalize">{statusStr}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute mb-1">Stake</div>
            <div className="font-mono text-[15px] font-medium">{(Number(arbitrator.effectiveStake) / 1e9).toFixed(2)}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute mb-1">Cases</div>
            <div className="font-mono text-[15px] font-medium">{arbitrator.casesParticipated}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute mb-1">Bad faith</div>
            <div className={`font-mono text-[15px] font-medium ${arbitrator.badFaithStrikes > 0 ? 'text-danger' : ''}`}>
              {arbitrator.badFaithStrikes}
            </div>
          </div>
        </div>
      </div>

      {needsReveal.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-warning">Pending reveals ({needsReveal.length})</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {needsReveal.map((d) => (
              <DisputeCard key={d.caseId.toString()} dispute={d} />
            ))}
          </div>
        </div>
      )}

      {needsCommit.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-info">Needs commit ({needsCommit.length})</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {needsCommit.map((d) => (
              <DisputeCard key={d.caseId.toString()} dispute={d} />
            ))}
          </div>
        </div>
      )}

      {cases.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">All assigned ({cases.length})</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cases.map((d) => (
              <DisputeCard key={d.caseId.toString()} dispute={d} />
            ))}
          </div>
        </div>
      )}

      {cases.length === 0 && (
        <p className="font-mono text-[11px] text-mute">No cases assigned yet.</p>
      )}
    </div>
  );
}
