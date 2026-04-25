import Link from 'next/link';

export type RoadmapPhase = {
  status: 'live' | 'shipping' | 'next' | 'later';
  statusLabel: string;
  title: string;
  summary: string;
  items: string[];
};

export const roadmapPhases: RoadmapPhase[] = [
  {
    status: 'live',
    statusLabel: 'Live now',
    title: 'Operator loop + builder surfaces',
    summary: 'What builders and operators can use across the repo, devnet app, and public packages.',
    items: [
      'Landing site, docs, specs, and the devnet app shell',
      'Agent registration, detail pages, capability leaderboards, and task-led marketplace matching',
      'Template catalog, wallet-backed rentals, fork-lineage linking, rentals view, and simulator',
      'Managed x402 settlement path plus MCP, Solana Agent Kit, Python SDK, and Hermes Agent plugin',
      'Webhook delivery with signed headers, replay metadata, secret rotation, delivery IDs, and filterable logs',
    ],
  },
  {
    status: 'shipping',
    statusLabel: 'Shipping now',
    title: 'Productive treasuries + hosted visibility',
    summary: 'The current lane turns constrained treasury capital into an auditable operator flow.',
    items: [
      'Kamino-only treasury yield adapter with deposit, withdraw, emergency unwind, and StrategyPosition accounting',
      'Treasury operator UI for allocation caps, route preparation, wallet submission, and deployed/realized-yield state',
      'Discovery/indexer snapshots for strategy descriptors, treasury yield config, and per-position accounting',
      'Hosted indexer ingest repair so yield, marketplace, and treasury state stay visible off-chain',
      'Devnet smoke path and audit-gated activation before any mainnet yield claims',
    ],
  },
  {
    status: 'next',
    statusLabel: 'Next',
    title: 'Trust, operator UX, and richer markets',
    summary: 'After the treasury lane, the focus returns to user-facing confidence and repeatable operator workflows.',
    items: [
      'Deeper reputation graph mechanics: proof-bound writes, decay, slashing rollups, anti-gaming, and production leaderboards',
      'Webhook admin UX for subscriptions, delivery logs, replay/backfill, and operator notifications',
      'Richer template marketplace discovery with author reputation, template-to-task flows, and multi-agent simulations',
      'A2A marketplace flow beyond the current panel: orchestrator tasks, sub-agent bidding, and proof-gated settlement',
      'Fee collector, rewards rollups, retro distribution plumbing, and broader dispute controls',
    ],
  },
  {
    status: 'later',
    statusLabel: 'Later',
    title: 'Expansion rails',
    summary: 'Longer-horizon work once the Solana operator loop is reliable, observable, and boring.',
    items: [
      'Token-2022 canonical mint readiness, authority verification, and staking/tokenomics maturation',
      'Confidential and privacy-preserving payment flows',
      'LayerZero-plus-intents cross-chain settlement path',
      'Compute-bond protocol enforcement with release, slash, expiry, and dispute integration',
      'Reusable ZK circuit catalog, verification-key versioning, and gated ZK-ML research',
    ],
  },
];

const STATUS_STYLES: Record<RoadmapPhase['status'], string> = {
  live: 'border-lime/30 text-lime',
  shipping: 'border-amber-400/30 text-amber-500',
  next: 'border-ink/20 text-ink/60',
  later: 'border-ink/20 text-ink/60',
};

function PhaseCard({ phase }: { phase: RoadmapPhase }) {
  return (
    <article className="border border-ink/15 bg-paper p-6">
      <div className="flex items-center justify-between gap-4">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${STATUS_STYLES[phase.status]}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              phase.status === 'live'
                ? 'bg-lime'
                : phase.status === 'shipping'
                  ? 'bg-amber-400'
                  : 'bg-ink/30'
            }`}
          />
          {phase.statusLabel}
        </span>
      </div>
      <h3 className="mt-4 font-display text-[clamp(26px,3vw,40px)] leading-[0.98] tracking-[-0.01em]">
        {phase.title}
      </h3>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/75">{phase.summary}</p>
      <ul className="mt-6 flex flex-col gap-3 text-[15px] leading-relaxed text-ink/85">
        {phase.items.map((item) => (
          <li key={item} className="border-t border-ink/10 pt-3">
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function RoadmapSnapshot() {
  return (
    <section className="bg-paper-2 text-ink px-[clamp(20px,5vw,80px)] py-[clamp(72px,9vw,128px)]">
      <div className="flex items-center justify-between border-b border-ink/15 pb-4 mb-10">
        <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">§04</span>
        <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">Roadmap</span>
      </div>

      <div className="grid md:grid-cols-12 gap-10 items-end mb-12">
        <h2 className="md:col-span-8 font-display text-[clamp(32px,4.5vw,56px)] leading-[0.95] tracking-[-0.01em]">
          Shipping the agent economy in layers.
        </h2>
        <p className="md:col-span-4 text-[16px] text-ink/75">
          The roadmap now mirrors the current repo and devnet portal surface: what is live today,
          what is actively being wired, and what comes after the operator loop is fully in place.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {roadmapPhases.map((phase) => (
          <PhaseCard key={phase.title} phase={phase} />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-6 font-mono uppercase text-[11px] tracking-[0.08em]">
        <Link href="/roadmap" className="border-b border-ink hover:text-lime hover:border-lime">
          Full roadmap →
        </Link>
        <Link href="/dashboard" className="border-b border-ink hover:text-lime hover:border-lime">
          Enter app →
        </Link>
      </div>
    </section>
  );
}
