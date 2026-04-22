'use client';

import type { DiscoveryComputeBondSummary } from '@saep/sdk-ui';

const STATUS_STYLE: Record<string, string> = {
  reserved: 'text-ink/70 bg-ink/5 border-ink/10',
  locked: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  released: 'text-lime bg-lime/10 border-lime/20',
  slashed: 'text-danger bg-danger/10 border-danger/20',
  cancelled: 'text-ink/60 bg-ink/5 border-ink/10',
  expired: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20',
};

function fmtUnix(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtUsdMicro(v: number | null): string {
  if (v == null) return '—';
  return `$${(v / 1_000_000).toFixed(2)}`;
}

function short(value: string, start = 10, end = 6): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function statusCounts(bonds: readonly DiscoveryComputeBondSummary[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const bond of bonds) {
    counts.set(bond.status, (counts.get(bond.status) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function ComputeBondSummary({ bonds }: { bonds: readonly DiscoveryComputeBondSummary[] }) {
  if (bonds.length === 0) {
    return <span className="text-[11px] text-ink/40">No compute bond</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {statusCounts(bonds).map(([status, count]) => (
        <span
          key={status}
          className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${STATUS_STYLE[status] ?? 'text-ink/60 bg-ink/5 border-ink/10'}`}
        >
          {count} {status}
        </span>
      ))}
    </div>
  );
}

export function ComputeBondPanel({
  bonds,
  isLoading,
  error,
}: {
  bonds: readonly DiscoveryComputeBondSummary[] | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Compute Bonds</h2>
          <p className="text-[11px] text-ink/50">Broker-backed lease state visible through Discovery.</p>
        </div>
        <span className="text-[10px] font-mono uppercase text-ink/50">
          {bonds?.length ?? 0} tracked
        </span>
      </header>

      {isLoading && <p className="font-mono text-[11px] text-ink/50">Loading compute bonds…</p>}
      {!isLoading && error && (
        <p className="font-mono text-[11px] text-danger">
          Compute bond visibility unavailable: {error.message}
        </p>
      )}
      {!isLoading && !error && bonds && bonds.length === 0 && (
        <p className="font-mono text-[11px] text-ink/50">No tracked compute bonds for this task yet.</p>
      )}

      {!isLoading && !error && bonds && bonds.length > 0 && (
        <div className="grid gap-3">
          {bonds.map((bond) => (
            <div key={bond.leaseId} className="border border-ink/10 bg-ink/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <div className="font-mono text-[11px] text-ink">{short(bond.leaseId, 14, 8)}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink/60">
                    <span className="uppercase tracking-wider">{bond.provider}</span>
                    <span>{bond.gpuHours} GPU hrs</span>
                    {bond.providerStatus && <span>provider: {bond.providerStatus}</span>}
                  </div>
                </div>
                <span
                  className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${STATUS_STYLE[bond.status] ?? 'text-ink/60 bg-ink/5 border-ink/10'}`}
                >
                  {bond.status}
                </span>
              </div>

              <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
                <div>
                  <dt className="text-ink/50">Reserved price</dt>
                  <dd className="font-mono text-ink">{fmtUsdMicro(bond.reservedPriceUsdMicro)}</dd>
                </div>
                <div>
                  <dt className="text-ink/50">Expires</dt>
                  <dd className="font-mono text-ink">{fmtUnix(bond.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="text-ink/50">Slashable until</dt>
                  <dd className="font-mono text-ink">{fmtUnix(bond.slashableUntil)}</dd>
                </div>
                <div>
                  <dt className="text-ink/50">Updated</dt>
                  <dd className="font-mono text-ink">
                    {new Date(bond.updatedAtMs).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </dd>
                </div>
              </dl>

              {bond.statusReason && (
                <p className="mt-3 text-[11px] text-danger">
                  Reason: <span className="font-mono">{bond.statusReason}</span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
