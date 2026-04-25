'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import type { TemplateRentalSummary, TemplateSummary } from '@saep/sdk';
import {
  useAllTemplates,
  useClaimRentalRevenue,
  useCloseTemplateRental,
  useTemplateRegistryConfig,
  useTemplateRentalsByRenter,
} from '@saep/sdk-ui';
import {
  formatBaseUnits,
  formatDurationShort,
  rentalClaimableAmount,
  rentalRemainingSeconds,
} from '@/lib/template-actions';
import { loadMintDecimals } from '@/lib/token-accounts';

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function shortKey(value: string): string {
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function titleForTemplate(template: TemplateSummary | undefined): string {
  if (!template) return 'Unknown template';
  if (template.configUri) {
    try {
      const url = new URL(template.configUri);
      return url.pathname.split('/').filter(Boolean).pop() ?? url.hostname;
    } catch {
      return template.configUri.length > 44 ? `${template.configUri.slice(0, 40)}...` : template.configUri;
    }
  }
  return `Template ${hexFromBytes(template.templateId).slice(0, 8)}`;
}

export default function TemplateRentalsPage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const registry = useTemplateRegistryConfig();
  const templates = useAllTemplates();
  const rentals = useTemplateRentalsByRenter(publicKey ?? null);
  const claim = useClaimRentalRevenue();
  const close = useCloseTemplateRental();
  const [decimals, setDecimals] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const templateByAddress = useMemo(() => {
    const map = new Map<string, TemplateSummary>();
    for (const template of templates.data ?? []) {
      map.set(template.address.toBase58(), template);
    }
    return map;
  }, [templates.data]);

  useEffect(() => {
    if (!registry.data) return;
    loadMintDecimals(connection, registry.data.rentEscrowMint)
      .then(setDecimals)
      .catch(() => setDecimals(6));
  }, [connection, registry.data]);

  async function claimRental(rental: TemplateRentalSummary, template: TemplateSummary | undefined) {
    setError(null);
    setLastSignature(null);
    if (!registry.data || !template) {
      setError('Template or registry data is not available for this rental.');
      return;
    }
    try {
      const result = await claim.mutateAsync({
        rental: rental.address,
        templateId: template.templateId,
        mint: registry.data.rentEscrowMint,
        author: template.author,
        feeCollectorTokenAccount: registry.data.feeCollector,
      });
      setLastSignature(result.signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim transaction failed');
    }
  }

  async function closeRental(rental: TemplateRentalSummary, template: TemplateSummary | undefined) {
    setError(null);
    setLastSignature(null);
    if (!registry.data || !template) {
      setError('Template or registry data is not available for this rental.');
      return;
    }
    try {
      const result = await close.mutateAsync({
        rental: rental.address,
        templateId: template.templateId,
        mint: registry.data.rentEscrowMint,
        author: template.author,
        feeCollectorTokenAccount: registry.data.feeCollector,
        renter: rental.renter,
      });
      setLastSignature(result.signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Close transaction failed');
    }
  }

  const rows: TemplateRentalSummary[] = rentals.data ?? [];

  return (
    <section className="flex max-w-6xl flex-col gap-6">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
          template rentals
        </div>
        <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-tight">My template rentals</h1>
            <p className="mt-2 max-w-3xl text-sm text-mute">
              Track active leases, claim accrued author/platform revenue where possible, and close
              rentals from the connected wallet.
            </p>
          </div>
          <Link
            href="/templates"
            className="inline-flex items-center justify-center border border-ink/15 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink transition-colors hover:border-ink/35 hover:bg-ink/5"
          >
            Browse templates
          </Link>
        </div>
      </header>

      {!publicKey ? (
        <div className="border border-dashed border-ink/20 p-8 text-center">
          <p className="font-mono text-sm text-mute">CONNECT WALLET TO VIEW RENTALS</p>
        </div>
      ) : null}

      {error ? (
        <p className="border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {lastSignature ? (
        <div className="border border-lime/30 bg-lime/10 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-lime">Last transaction</div>
          <div className="mt-1 break-all font-mono text-[11px] text-ink">{lastSignature}</div>
        </div>
      ) : null}

      {publicKey && rentals.isLoading ? (
        <p className="font-mono text-[11px] text-mute">Loading rentals...</p>
      ) : null}

      {publicKey && rows.length === 0 && !rentals.isLoading ? (
        <div className="border border-dashed border-ink/20 p-8 text-center">
          <p className="font-mono text-sm text-mute">NO RENTALS FOR CONNECTED WALLET</p>
          <Link
            href="/templates"
            className="mt-4 inline-flex items-center justify-center border border-lime/30 bg-lime/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-lime transition-colors hover:border-lime/50 hover:bg-lime/15"
          >
            Find a template
          </Link>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="grid gap-4">
          {rows.map((rental) => {
            const template = templateByAddress.get(rental.template.toBase58());
            const remaining = rentalRemainingSeconds(
              { endTime: rental.endTime, status: rental.status },
            );
            const claimable = rentalClaimableAmount({
              startTime: rental.startTime,
              endTime: rental.endTime,
              dripRatePerSec: rental.dripRatePerSec.toString(),
              claimedAuthor: rental.claimedAuthor.toString(),
              claimedPlatform: rental.claimedPlatform.toString(),
            });
            const active = rental.status === 'active';

            return (
              <article key={rental.address.toBase58()} className="border border-ink/10 bg-paper p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="font-display text-xl tracking-tight">
                      {titleForTemplate(template)}
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] text-ink/45">
                      {rental.address.toBase58()}
                    </div>
                  </div>
                  <span className="w-fit border border-ink/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-mute">
                    {rental.status}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Metric label="Prepaid" value={formatBaseUnits(rental.prepaidAmount, decimals)} />
                  <Metric label="Claimable" value={formatBaseUnits(claimable, decimals)} />
                  <Metric label="Claimed author" value={formatBaseUnits(rental.claimedAuthor, decimals)} />
                  <Metric label="Remaining" value={formatDurationShort(remaining)} />
                  <Metric label="Renter" value={shortKey(rental.renter.toBase58())} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {template ? (
                    <Link
                      href={`/templates/${hexFromBytes(template.templateId)}`}
                      className="inline-flex items-center justify-center border border-ink/15 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink/70 transition-colors hover:border-ink/30 hover:bg-ink/5 hover:text-ink"
                    >
                      Open template
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    disabled={!active || !template || claimable <= 0n || claim.isPending}
                    onClick={() => claimRental(rental, template)}
                    className="inline-flex items-center justify-center border border-lime/30 bg-lime/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-lime transition-colors hover:border-lime/50 hover:bg-lime/15 disabled:cursor-not-allowed disabled:border-ink/10 disabled:bg-ink/5 disabled:text-mute"
                  >
                    {claim.isPending ? 'Claiming...' : 'Claim accrual'}
                  </button>
                  <button
                    type="button"
                    disabled={!active || !template || close.isPending}
                    onClick={() => closeRental(rental, template)}
                    className="inline-flex items-center justify-center border border-ink/15 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink/70 transition-colors hover:border-ink/30 hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:border-ink/10 disabled:bg-ink/5 disabled:text-mute"
                  >
                    {close.isPending ? 'Closing...' : 'Close rental'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-ink/10 bg-paper-2 p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <div className="mt-2 truncate font-mono text-[11px] text-ink">{value}</div>
    </div>
  );
}
