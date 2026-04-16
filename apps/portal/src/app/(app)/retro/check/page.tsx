'use client';

import { useMemo } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useRetroEligibility, useSession } from '@saep/sdk-ui';

const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? 'http://127.0.0.1:8080';

const TIER_LABEL: Record<'none' | 'basic' | 'verified', string> = {
  none: 'Unverified',
  basic: 'Basic (50%)',
  verified: 'Verified (100%)',
};

function formatMicroUsdc(micro: number): string {
  return (micro / 1_000_000).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function formatTokens(raw: string | null): string {
  if (!raw) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatRelative(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function RetroCheckPage() {
  const { data: session } = useSession();

  const operatorHex = useMemo<string | null>(() => {
    if (!session?.address) return null;
    try {
      return Buffer.from(new PublicKey(session.address).toBytes()).toString('hex');
    } catch {
      return null;
    }
  }, [session?.address]);

  const { data, isLoading, error } = useRetroEligibility({
    indexerUrl: INDEXER_URL,
    operatorHex,
  });

  return (
    <section className="flex flex-col gap-6 max-w-3xl">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Retro eligibility</h1>
        <p className="text-sm text-ink/60">
          Estimated allocation for the signed-in operator based on trailing-window
          fee contribution through fee_collector. Pre-M3: estimate only, no claim.
        </p>
      </header>

      {!operatorHex && (
        <p className="text-sm text-ink/60">Sign in to view eligibility.</p>
      )}

      {error && (
        <p className="text-sm text-danger">
          Failed to load eligibility: {(error as Error).message}
        </p>
      )}

      {isLoading && operatorHex && (
        <p className="text-sm text-ink/50">Loading eligibility...</p>
      )}

      {operatorHex && !isLoading && !error && data === null && (
        <div className="rounded border border-ink/10 p-6 flex flex-col gap-2">
          <p className="text-sm">No eligibility record for this operator.</p>
          <p className="text-xs text-ink/50">
            Generate fees via task settlement through a SAEP treasury to appear in
            the trailing-window rollup.
          </p>
        </div>
      )}

      {data && (
        <div className="rounded border border-ink/10 overflow-hidden">
          <dl className="grid grid-cols-2 text-sm">
            <Row label="Operator">
              <span className="font-mono text-xs">
                {data.operatorHex.slice(0, 12)}…{data.operatorHex.slice(-8)}
              </span>
            </Row>
            <Row label="Estimated allocation">
              <span className="font-mono text-base">
                {formatTokens(data.estimatedAllocation)} SAEP
              </span>
            </Row>
            <Row label="Net fees (trailing)">
              {formatMicroUsdc(data.netFeesMicroUsdc)}
            </Row>
            <Row label="Wash-excluded">
              <span className="text-ink/60">
                {formatMicroUsdc(data.washExcludedMicroUsdc)}
              </span>
            </Row>
            <Row label="Personhood tier">{TIER_LABEL[data.personhoodTier]}</Row>
            <Row label="Personhood multiplier">×{data.personhoodMultiplier}</Row>
            <Row label="Cold-start multiplier">×{data.coldStartMultiplier}</Row>
            <Row label="First seen">epoch {data.epochFirstSeen}</Row>
            <Row label="Updated">{formatRelative(data.lastUpdatedUnix)}</Row>
          </dl>
        </div>
      )}

      <footer className="text-xs text-ink/50 border-t border-ink/10 pt-4">
        Allocations are estimates against the current rollup epoch. Final
        distribution is gated on M3 token launch and Halborn audit sign-off per
        <span className="font-mono"> specs/retro-airdrop.md</span>.
      </footer>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="px-4 py-3 bg-ink/5 text-ink/60 border-b border-ink/5">
        {label}
      </dt>
      <dd className="px-4 py-3 border-b border-ink/5">{children}</dd>
    </>
  );
}
