'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useForkTemplate } from '@saep/sdk-ui';
import type { SerializedTemplate } from '@/lib/template-serializer';
import { bytesFromHex } from '@/lib/template-actions';
import { templateTitle } from '@/lib/template-marketplace';

interface Props {
  template: SerializedTemplate;
  registryPaused: boolean;
}

export function ForkTemplateForm({ template, registryPaused }: Props) {
  const { publicKey } = useWallet();
  const forkTemplate = useForkTemplate();
  const [childDid, setChildDid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const disabledReason = (() => {
    if (registryPaused) return 'Template registry is paused.';
    if (template.status !== 'published') return 'Only published templates can be fork-linked.';
    if (!publicKey) return 'Connect a wallet to link a fork.';
    if (!/^[0-9a-fA-F]{64}$/.test(childDid.trim())) return 'Enter the child agent DID as 32-byte hex.';
    return null;
  })();

  async function submit() {
    setError(null);
    setSignature(null);
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    try {
      const result = await forkTemplate.mutateAsync({
        parentTemplateId: bytesFromHex(template.templateId, 'template id'),
        childAgentDid: bytesFromHex(childDid, 'child agent DID'),
      });
      setSignature(result.signature);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fork lineage transaction failed');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="border border-ink/10 bg-paper p-5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
          Fork lineage
        </div>
        <h2 className="mt-2 font-display text-2xl tracking-tight">{templateTitle(template)}</h2>
        <p className="mt-2 text-sm leading-6 text-ink/65">
          This records that a child agent DID was forked from the template. It does not register a
          new agent, copy runtime config, or fund a treasury by itself.
        </p>

        <label className="mt-5 flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Child agent DID hex
          </span>
          <input
            value={childDid}
            onChange={(event) => setChildDid(event.target.value)}
            placeholder="64 hex chars"
            className="h-11 border border-ink/10 bg-transparent px-3 font-mono text-sm outline-none transition-colors focus:border-lime/40"
          />
        </label>

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
            disabled={forkTemplate.isPending || Boolean(disabledReason)}
            onClick={submit}
            className="inline-flex items-center justify-center border border-lime/30 bg-lime/10 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-lime transition-colors hover:border-lime/50 hover:bg-lime/15 disabled:cursor-not-allowed disabled:border-ink/10 disabled:bg-ink/5 disabled:text-mute"
          >
            {forkTemplate.isPending ? 'Signing...' : 'Link fork lineage'}
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
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            What this enables
          </div>
          <div className="mt-4 grid gap-3">
            <InfoRow
              label="Lineage"
              value="The template fork counter increments and the child DID gets a reverse pointer."
            />
            <InfoRow
              label="Royalty snapshot"
              value="The template royalty is frozen for this fork record, so later edits do not retroactively change the lineage terms."
            />
            <InfoRow
              label="Runtime"
              value="Agent registration, treasury funding, and deployment still happen through the normal agent flows."
            />
          </div>
        </div>

        {signature ? (
          <div className="border border-lime/30 bg-lime/10 p-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-lime">
              Fork linked
            </div>
            <div className="mt-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-lime/70">
                Signature
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-ink">{signature}</div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink/10 bg-paper-2 px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <p className="mt-2 text-sm leading-6 text-ink/70">{value}</p>
    </div>
  );
}
