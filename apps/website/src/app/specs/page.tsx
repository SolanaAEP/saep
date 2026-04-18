import type { Metadata } from 'next';
import { PageShell } from '@/components/page-shell';
import { GlitchComposition } from '@saep/ui';
import { specIndex, type SpecEntry } from '@/content/spec-index';

export const metadata: Metadata = {
  title: 'Specs',
  description: 'Full program, circuit, and service specifications for the SAEP protocol.',
};

const kindLabel: Record<SpecEntry['kind'], string> = {
  overview: 'Overview',
  program: 'On-chain program',
  circuit: 'Circuit',
  service: 'Off-chain service',
  ops: 'Operations',
};

const kindOrder: SpecEntry['kind'][] = ['overview', 'program', 'circuit', 'service', 'ops'];

export default function SpecsIndexPage() {
  const grouped = kindOrder.map((k) => ({
    kind: k,
    items: specIndex.filter((s) => s.kind === k),
  }));

  return (
    <PageShell
      eyebrow="Section 02"
      crumbs={[{ label: 'Specs' }]}
      title="Protocol specifications."
      lede="Every program, circuit, and service in SAEP has a source-of-truth spec. These pages mirror the specs the audit firms review — no marketing gloss, no omissions."
    >
      <div className="flex flex-col gap-16">
        {grouped.map((g) =>
          g.items.length === 0 ? null : (
            <section key={g.kind}>
              <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-6">
                <h2 className="font-display text-[22px] tracking-[-0.01em]">
                  {kindLabel[g.kind]}
                </h2>
                <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                  {g.items.length} {g.items.length === 1 ? 'spec' : 'specs'}
                </span>
              </div>
              <ul className="grid md:grid-cols-2 gap-px bg-ink/15">
                {g.items.map((s) => (
                  <li key={s.slug} className="bg-paper">
                    <a
                      href={`/specs/${s.slug}`}
                      className="block p-6 h-full hover:bg-paper-2 transition-colors"
                    >
                      <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                        /{s.slug}
                      </div>
                      <div className="mt-3 font-display text-[22px] tracking-[-0.01em]">
                        {s.title}
                      </div>
                      <p className="mt-2 text-[14px] text-ink/75 leading-relaxed">{s.summary}</p>
                      <div className="mt-4 font-mono uppercase text-[11px] tracking-[0.08em] text-ink">
                        Read →
                      </div>
                    </a>
                  </li>
                ))}
                {g.items.length % 2 === 1 ? (
                  <li className="bg-paper hidden md:block">
                    <GlitchComposition
                      seed={`${g.kind}-${g.items.length}`}
                      className="w-full h-full"
                    />
                  </li>
                ) : null}
              </ul>
            </section>
          )
        )}
      </div>
    </PageShell>
  );
}
