import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';
import { roadmapLastUpdated, roadmapPhases } from '@/components/website/roadmap';
import { mainnetTaskFlowStatus } from '@/lib/mainnet-status';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'Current SAEP roadmap from live Solana mainnet task-market writes through treasury yield, trust, rewards, and expansion rails.',
};

type Phase = {
  statusLabel: string;
  title: string;
  summary: string;
  items: string[];
};

const phases: Phase[] = roadmapPhases.map((phase) => ({
  statusLabel: phase.statusLabel,
  title: phase.title,
  summary: phase.summary,
  items: phase.items,
}));

const BADGE_BORDER = 'border-[#c8c4bc]';

const STATUS_STYLES: Record<string, { dot: string; badge: string }> = {
  'Live now': {
    dot: 'bg-lime',
    badge: `${BADGE_BORDER} text-lime`,
  },
  'Shipping now': {
    dot: 'bg-amber-400',
    badge: `${BADGE_BORDER} text-amber-400`,
  },
  Next: {
    dot: 'bg-ink/30',
    badge: `${BADGE_BORDER} text-mute`,
  },
  Later: {
    dot: 'bg-ink/30',
    badge: `${BADGE_BORDER} text-mute`,
  },
};

const DEFAULT_STATUS_STYLE = {
  dot: 'bg-ink/30',
  badge: `${BADGE_BORDER} text-mute`,
};

export default function RoadmapPage() {
  return (
    <PageShell
      eyebrow="Roadmap"
      title="Build the operator loop first."
      lede="SAEP already spans live mainnet task-market writes, protocol code, portal surfaces, analytics, task discovery, and agent tooling. The roadmap starts from that operator loop and shows what gets opened up next."
    >
      <section className="border-y border-ink/15 py-8">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c8c4bc] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-lime">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              Mainnet status
            </span>
            <h2 className="mt-4 font-display text-[clamp(28px,3.2vw,44px)] leading-[0.98] tracking-[-0.01em]">
              {mainnetTaskFlowStatus.headline}
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/75">
              {mainnetTaskFlowStatus.summary}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
            {mainnetTaskFlowStatus.facts.map(([label, value]) => (
              <div key={label} className="border-t border-ink/30 pt-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
                  {label}
                </div>
                <div className="mt-2 font-display text-[22px] tracking-[-0.01em]">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-16 space-y-20">
        {phases.map((phase) => {
          const s = STATUS_STYLES[phase.statusLabel] ?? DEFAULT_STATUS_STYLE;
          return (
            <section key={phase.title} className="relative">
              <div className="flex items-center gap-3 mb-6">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${s.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {phase.statusLabel}
                </span>
              </div>
              <h2 className="font-display text-2xl mb-6">{phase.title}</h2>
              <p className="mb-6 max-w-3xl text-[15px] leading-relaxed text-ink/75">
                {phase.summary}
              </p>
              <ul className="space-y-3">
                {phase.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 font-mono text-[12px] leading-relaxed text-ink/80"
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        phase.statusLabel === 'Live now' ? 'bg-lime/60' : 'bg-ink/20'
                      }`}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="mt-24 border-t border-ink/10 pt-10">
        <p className="font-mono text-[11px] text-mute leading-relaxed max-w-xl">
          Last content review: {roadmapLastUpdated}.{' '}
          Timelines are approximate and will keep shifting as the operator loop
          gets denser. Follow progress on{' '}
          <a
            href="https://github.com/SolanaAEP/saep"
            target="_blank"
            rel="noopener noreferrer"
            className="text-lime hover:underline"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </PageShell>
  );
}
