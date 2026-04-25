'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { rentalPda } from '@saep/sdk';
import { useRentTemplate, useTemplateRegistryProgram } from '@saep/sdk-ui';
import type {
  SerializedTemplate,
  SerializedTemplateRegistryConfig,
} from '@/lib/template-serializer';
import {
  bytesFromHex,
  formatBaseUnits,
  formatDurationShort,
  rentalPrepaidAmount,
} from '@/lib/template-actions';
import { templateTitle } from '@/lib/template-marketplace';
import { loadMintDecimals, loadTokenAccountBalance } from '@/lib/token-accounts';

interface Props {
  template: SerializedTemplate;
  registry: SerializedTemplateRegistryConfig | null;
}

function durationHours(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 3_600));
}

export function RentTemplateForm({ template, registry }: Props) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useTemplateRegistryProgram();
  const rent = useRentTemplate();
  const [duration, setDuration] = useState(String(durationHours(template.minRentDuration)));
  const [decimals, setDecimals] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    signature: string;
    rental: string;
    prepaid: bigint;
    durationSecs: number;
  } | null>(null);

  const minHours = durationHours(template.minRentDuration);
  const maxHours = durationHours(template.maxRentDuration);
  const durationSecs = useMemo(() => {
    const parsed = Number(duration);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.floor(parsed * 3_600));
  }, [duration]);
  const prepaid = useMemo(
    () => rentalPrepaidAmount(template.rentPricePerSec, durationSecs),
    [durationSecs, template.rentPricePerSec],
  );
  const disabledReason = useMemo(() => {
    if (!registry) return 'Template registry config is not available.';
    if (registry.paused) return 'Template rentals are paused by the registry.';
    if (template.status !== 'published') return 'Only published templates can be rented.';
    if (BigInt(template.rentPricePerSec || '0') <= 0n) return 'This template has rentals disabled.';
    if (!publicKey) return 'Connect a wallet to rent this template.';
    if (durationSecs < template.minRentDuration || durationSecs > template.maxRentDuration) {
      return `Choose ${formatDurationShort(template.minRentDuration)} to ${formatDurationShort(template.maxRentDuration)}.`;
    }
    return null;
  }, [durationSecs, publicKey, registry, template]);

  useEffect(() => {
    if (!registry) return;
    const mint = new PublicKey(registry.rentEscrowMint);
    loadMintDecimals(connection, mint)
      .then(setDecimals)
      .catch(() => setDecimals(6));
  }, [connection, registry]);

  async function submit() {
    setError(null);
    setReceipt(null);
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    if (!registry || !publicKey || !program) {
      setError('Wallet or template program is not ready.');
      return;
    }

    try {
      const mint = new PublicKey(registry.rentEscrowMint);
      const balance = await loadTokenAccountBalance(connection, mint, publicKey);
      setDecimals(balance.decimals);
      if (balance.amount < prepaid) {
        throw new Error(
          `Insufficient escrow mint balance. Need ${formatBaseUnits(prepaid, balance.decimals)}, have ${formatBaseUnits(balance.amount, balance.decimals)}.`,
        );
      }

      const nonce = crypto.getRandomValues(new Uint8Array(8));
      const [rental] = rentalPda(
        program.programId,
        new PublicKey(template.address),
        publicKey,
        nonce,
      );
      const result = await rent.mutateAsync({
        templateId: bytesFromHex(template.templateId, 'template id'),
        mint,
        durationSecs: BigInt(durationSecs),
        rentalNonce: nonce,
        renterTokenAccount: balance.address,
      });
      setReceipt({
        signature: result.signature,
        rental: rental.toBase58(),
        prepaid,
        durationSecs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rental transaction failed');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="border border-ink/10 bg-paper p-5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Rent template</div>
        <h2 className="mt-2 font-display text-2xl tracking-tight">{templateTitle(template)}</h2>
        <p className="mt-2 text-sm leading-6 text-ink/65">
          Open a rental escrow for this template. The prepaid amount is locked in the registry
          escrow and can be claimed over time according to the template rental policy.
        </p>

        <label className="mt-5 flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Duration in hours
          </span>
          <input
            inputMode="numeric"
            min={minHours}
            max={maxHours}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            className="h-11 border border-ink/10 bg-transparent px-3 text-sm outline-none transition-colors focus:border-lime/40"
          />
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Allowed window" value={`${formatDurationShort(template.minRentDuration)} - ${formatDurationShort(template.maxRentDuration)}`} />
          <Metric label="Prepaid" value={formatBaseUnits(prepaid, decimals)} />
          <Metric label="Escrow mint" value={`${registry?.rentEscrowMint.slice(0, 4) ?? 'n/a'}...${registry?.rentEscrowMint.slice(-4) ?? ''}`} />
        </div>

        {disabledReason ? (
          <p className="mt-4 border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-700">
            {disabledReason}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 border border-danger/30 bg-danger/5 px-3 py-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={rent.isPending || Boolean(disabledReason)}
            onClick={submit}
            className="inline-flex items-center justify-center border border-lime/30 bg-lime/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-lime transition-colors hover:border-lime/50 hover:bg-lime/15 disabled:cursor-not-allowed disabled:border-ink/10 disabled:bg-ink/5 disabled:text-mute"
          >
            {rent.isPending ? 'Signing...' : 'Rent and sign'}
          </button>
          <Link
            href={`/templates/${template.templateId}`}
            className="inline-flex items-center justify-center border border-ink/15 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-ink/70 transition-colors hover:border-ink/30 hover:bg-ink/5 hover:text-ink"
          >
            Back to detail
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="border border-ink/10 bg-paper p-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">Rental state</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Metric label="Renter" value={publicKey ? publicKey.toBase58() : 'Wallet not connected'} />
            <Metric label="Template" value={template.address} />
            <Metric label="Rate" value={`${template.rentPricePerSec} units/sec`} />
            <Metric label="Registry" value={registry?.paused ? 'Paused' : 'Accepting rentals'} />
          </div>
        </div>

        {receipt ? (
          <div className="border border-lime/30 bg-lime/10 p-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-lime">Rental opened</div>
            <div className="mt-3 grid gap-3 text-sm">
              <ReceiptRow label="Rental PDA" value={receipt.rental} />
              <ReceiptRow label="Signature" value={receipt.signature} />
              <ReceiptRow label="Prepaid" value={formatBaseUnits(receipt.prepaid, decimals)} />
              <ReceiptRow label="Duration" value={formatDurationShort(receipt.durationSecs)} />
            </div>
            <Link
              href="/templates/rentals"
              className="mt-4 inline-flex items-center justify-center border border-lime/30 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-lime transition-colors hover:bg-lime/10"
            >
              View my rentals
            </Link>
          </div>
        ) : null}
      </section>
    </div>
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

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-lime/70">{label}</div>
      <div className="mt-1 break-all font-mono text-[11px] text-ink">{value}</div>
    </div>
  );
}
