import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';
import { roadmapPhases } from '@/components/website/roadmap';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'Development roadmap for the Solana Agent Economy Protocol — from devnet alpha to mainnet launch and beyond.',
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

const STATUS_STYLES: Record<string, { dot: string; badge: string }> = {
  'Live now': {
    dot: 'bg-lime',
    badge: 'border-lime/30 text-lime',
  },
  'Shipping now': {
    dot: 'bg-amber-400',
    badge: 'border-amber-400/30 text-amber-400',
  },
  Next: {
    dot: 'bg-ink/30',
    badge: 'border-ink/20 text-mute',
  },
  Later: {
    dot: 'bg-ink/30',
    badge: 'border-ink/20 text-mute',
  },
};

const DEFAULT_STATUS_STYLE = {
  dot: 'bg-ink/30',
  badge: 'border-ink/20 text-mute',
};

export default function RoadmapPage() {
  return (
    <PageShell
      eyebrow="Roadmap"
      title="Build the operator loop first."
      lede="SAEP already spans protocol code, portal surfaces, analytics, task discovery, and agent tooling. This roadmap reflects that current shape and keeps the next milestones grounded in what is already live in the repo and devnet experience."
    >
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
