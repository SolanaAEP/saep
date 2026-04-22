import { RESEARCH_CROSS_CHAIN_TRACKS } from '@saep/sdk';
import { getPublicServicePublicUrl } from '@/lib/public-service-routes';

const STATUS_STYLES = {
  live: 'bg-lime/10 text-lime border-lime/20',
  prototype: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  research: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  native: 'bg-lime/10 text-lime border-lime/20',
  active: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  next: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
} as const;

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: keyof typeof STATUS_STYLES;
}) {
  return (
    <span
      className={`inline-block font-mono text-[10px] tracking-wider px-2 py-0.5 border rounded uppercase ${STATUS_STYLES[tone]}`}
    >
      {label}
    </span>
  );
}

const CHAIN_STATUS = [
  { name: 'Solana', label: 'native', tone: 'native' as const },
  { name: 'XRPL', label: 'prototype', tone: 'active' as const },
  { name: 'Ethereum', label: 'next', tone: 'next' as const },
  { name: 'Arbitrum', label: 'next', tone: 'next' as const },
  { name: 'Base', label: 'next', tone: 'next' as const },
];

const FLOW_STEPS = [
  {
    title: 'External funding or intent',
    body: 'A caller funds a payment edge or creates a cross-chain intent with a deterministic timeout window.',
  },
  {
    title: 'Attestation and normalization',
    body: 'Bridge or intent metadata is verified and normalized before SAEP task creation on Solana.',
  },
  {
    title: 'Task funding on Solana',
    body: 'Once attested, the workflow is converted into a SAEP task with explicit escrow funding and status tracking.',
  },
  {
    title: 'Proof-bound settlement',
    body: 'Result submission, proof verification, payout release, or deterministic refund are recorded against the same workflow id.',
  },
];

export default function CrossChainPage() {
  return (
    <section className="flex flex-col gap-10 max-w-6xl">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            11 // cross-chain
          </div>
          <h1 className="font-display text-2xl tracking-tight">Cross-Chain Settlement</h1>
          <p className="text-sm text-mute mt-1">
            Current live surfaces, prototype bridges, and the LayerZero-intents research path.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {RESEARCH_CROSS_CHAIN_TRACKS.map((item) => (
          <div key={item.id} className="border border-ink/10 p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-mono text-sm">{item.label}</h3>
              <Badge label={item.lifecycle} tone={item.lifecycle} />
            </div>
            <p className="text-sm text-mute leading-relaxed">{item.summary}</p>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
              sources: {item.supportedSources.join(', ')}
            </div>
            {item.id === 'x402-cctp-funding' ? (
              <a
                href="/docs/api#x402-gateway"
                className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink/60 hover:text-lime"
              >
                Public route: {getPublicServicePublicUrl('x402').replace(/^https?:\/\//, '')}
              </a>
            ) : null}
          </div>
        ))}
      </div>

      <div className="border border-ink/10 p-6">
        <h2 className="font-display text-lg tracking-tight mb-5">Research Build Order</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          {FLOW_STEPS.map((step, index) => (
            <div key={step.title} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-lime">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[10px] text-mute uppercase tracking-wider">
                  step
                </span>
              </div>
              <span className="font-mono text-sm leading-relaxed">{step.title}</span>
              <span className="text-xs text-mute leading-relaxed">{step.body}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-display text-lg tracking-tight mb-4">Supported Chains</h2>
        <div className="border border-ink/10 divide-y divide-ink/10">
          {CHAIN_STATUS.map((chain) => (
            <div key={chain.name} className="flex items-center justify-between px-5 py-3">
              <span className="font-mono text-sm">{chain.name}</span>
              <Badge label={chain.label} tone={chain.tone} />
            </div>
          ))}
        </div>
      </div>

      <div className="border border-ink/10 p-6">
        <h2 className="font-display text-lg tracking-tight mb-4">What Is Live vs Next</h2>
        <div className="space-y-4 font-mono text-[12px] text-ink/80 leading-relaxed">
          <div>
            <span className="text-lime">Live today</span> — x402 remains the public payment edge,
            with task-correlated receipts and CCTP-assisted funding into SAEP’s Solana-side
            settlement flow.
          </div>
          <div>
            <span className="text-sky-400">Prototype today</span> — the XRPL bridge scaffold can
            originate Solana-side settlement, but it is still a bridge prototype rather than the
            default long-term cross-chain architecture.
          </div>
          <div>
            <span className="text-amber-400">Next research track</span> — LayerZero plus intents is
            the preferred path for deterministic timeout/refund handling and portable task funding.
            Wormhole is not the default roadmap.
          </div>
        </div>
      </div>
    </section>
  );
}
