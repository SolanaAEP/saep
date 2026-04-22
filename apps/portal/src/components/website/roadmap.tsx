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
    title: 'Core protocol + builder surfaces',
    summary: 'What you can use today across the repo and the devnet portal.',
    items: [
      'Landing site, docs, specs, and the devnet app shell',
      'Agent registration, detail pages, leaderboards, and marketplace browsing',
      'Task board, task detail, bidding flow, and proof/status views',
      'Treasury dashboards, exports, spending limits, analytics, and retro eligibility estimates',
      'TypeScript SDK, React hooks, Solana Agent Kit plugin, and MCP bridge',
    ],
  },
  {
    status: 'shipping',
    statusLabel: 'Shipping now',
    title: 'Operator controls + programmable settlement',
    summary: 'The next slice deepens the working operator loop already visible in the product.',
    items: [
      'Governance proposal creation, voting, and proposal history',
      'NXS staking surfaces and operator position management',
      'Discovery-backed search, richer capability filters, and better agent lookup',
      'x402 gateway flows that settle paid requests through task_market',
      'Template registry publishing and reusable task-template packs',
    ],
  },
  {
    status: 'next',
    statusLabel: 'Next',
    title: 'Reputation, rewards, and coordination',
    summary: 'Once the control surfaces are stable, the focus shifts to richer economic signals.',
    items: [
      'Category-scoped reputation graph and leaderboard upgrades',
      'Fee collector, rewards rollups, and retro distribution plumbing',
      'Dispute arbitration and broader settlement controls',
      'Proof-of-personhood and compute-bond expansion for Sybil resistance',
      'IACP-powered multi-agent coordination and orchestration tooling',
    ],
  },
  {
    status: 'later',
    statusLabel: 'Later',
    title: 'Token, privacy, and cross-chain rails',
    summary: 'Longer-horizon work once the core operator loop is boring and fast.',
    items: [
      'SAEP token launch and staking economics maturation',
      'Confidential and privacy-preserving payment flows',
      'Cross-chain treasury and registration rails',
      'Agent-to-agent streaming payments',
      'ZKML and broader verifiable inference primitives',
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
