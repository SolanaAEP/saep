'use client';

import { useBiddingState, useTaskBidsIndexed } from '@saep/sdk-ui';

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? 'http://127.0.0.1:8080';

const PHASE_COLOR: Record<string, string> = {
  commit: 'text-ink bg-ink/10',
  reveal: 'text-yellow-500 bg-yellow-500/10',
  settled: 'text-lime bg-lime/10',
  slashed: 'text-danger bg-danger/10',
  unknown: 'text-ink/50 bg-ink/5',
};

function fmtUnix(unix: number | null): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtMicro(v: string | null): string {
  if (!v) return '—';
  try {
    return (Number(BigInt(v)) / 1_000_000).toFixed(2);
  } catch {
    return v;
  }
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export function BiddingPanel({ taskIdHex }: { taskIdHex: string }) {
  const state = useBiddingState(INDEXER_URL, taskIdHex);
  const bids = useTaskBidsIndexed(INDEXER_URL, taskIdHex);

  if (state.isLoading) {
    return <p className="text-sm text-ink/50">Loading bidding…</p>;
  }
  if (state.error) {
    return <p className="text-sm text-danger">Bidding unavailable: {(state.error as Error).message}</p>;
  }
  if (!state.data || state.data.phase === 'unknown') {
    return (
      <div className="border border-ink/10 p-5">
        <h3 className="text-sm font-medium">Bidding</h3>
        <p className="text-xs text-ink/50 pt-1">No bid book opened for this task.</p>
      </div>
    );
  }

  const s = state.data;
  const bidRows = bids.data ?? [];

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Bidding</h3>
        <span className={`text-xs px-2 py-0.5 ${PHASE_COLOR[s.phase]}`}>{s.phase}</span>
      </header>

      <dl className="grid grid-cols-2 gap-y-2 text-xs">
        <dt className="text-ink/50">Bond</dt>
        <dd className="font-mono">{fmtMicro(s.bondAmount)} USDC</dd>
        <dt className="text-ink/50">Commit ends</dt>
        <dd className="font-mono">{fmtUnix(s.commitEndUnix)}</dd>
        <dt className="text-ink/50">Reveal ends</dt>
        <dd className="font-mono">{fmtUnix(s.revealEndUnix)}</dd>
        <dt className="text-ink/50">Commits</dt>
        <dd className="font-mono">{s.commitCount}</dd>
        <dt className="text-ink/50">Reveals</dt>
        <dd className="font-mono">{s.revealCount}</dd>
        {s.slashedCount > 0 && (
          <>
            <dt className="text-ink/50">Slashed</dt>
            <dd className="font-mono text-danger">{s.slashedCount}</dd>
          </>
        )}
        {s.winnerAgent && (
          <>
            <dt className="text-ink/50">Winner</dt>
            <dd className="font-mono text-lime">{shortAddr(s.winnerAgent)}</dd>
            <dt className="text-ink/50">Winning bid</dt>
            <dd className="font-mono">{fmtMicro(s.winnerAmount)} USDC</dd>
          </>
        )}
      </dl>

      {bidRows.length > 0 && (
        <div className="pt-2 border-t border-ink/10">
          <h4 className="text-xs font-medium text-ink/70 pb-2">Bidders</h4>
          <table className="w-full text-xs">
            <thead className="text-ink/50 text-left">
              <tr>
                <th className="pb-1 font-normal">Bidder</th>
                <th className="pb-1 font-normal text-right">Bond</th>
                <th className="pb-1 font-normal text-right">Revealed</th>
                <th className="pb-1 font-normal text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {bidRows.map((b) => (
                <tr key={b.bidder} className="border-t border-ink/5">
                  <td className="py-1 font-mono">{shortAddr(b.bidder)}</td>
                  <td className="py-1 font-mono text-right">{fmtMicro(b.bondPaid)}</td>
                  <td className="py-1 font-mono text-right">{fmtMicro(b.revealedAmount)}</td>
                  <td className="py-1 text-right">
                    {b.slashed ? (
                      <span className="text-danger">slashed</span>
                    ) : b.revealedAmount ? (
                      <span className="text-lime">revealed</span>
                    ) : (
                      <span className="text-ink/50">committed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
