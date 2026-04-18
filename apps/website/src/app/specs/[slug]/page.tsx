import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { Markdown } from '@/components/markdown';
import { loadSpec, allSpecSlugs } from '@/lib/specs';
import { specBySlug } from '@/content/spec-index';

export function generateStaticParams() {
  return allSpecSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entry = specBySlug.get(slug);
  if (!entry) return { title: 'Spec not found' };
  return {
    title: entry.title,
    description: entry.summary,
  };
}

const kindLabel = {
  overview: 'Overview',
  program: 'On-chain program',
  circuit: 'Circuit',
  service: 'Off-chain service',
  ops: 'Operations',
} as const;

export default async function SpecPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loaded = await loadSpec(slug);
  if (!loaded) notFound();
  const { entry, body } = loaded;

  return (
    <PageShell
      eyebrow={kindLabel[entry.kind]}
      crumbs={[{ label: 'Specs', href: '/specs' }, { label: entry.title }]}
      title={entry.title}
      lede={entry.summary}
    >
      <Markdown source={body} />
      <div className="mt-20 border-t border-ink/15 pt-8 flex flex-wrap gap-6 font-mono uppercase text-[11px] tracking-[0.08em]">
        <a href="/specs" className="border-b border-ink hover:text-[#06f512] hover:border-[#06f512]">
          ← All specs
        </a>
        <a
          href={`https://github.com/SolanaAEP/saep-website/blob/main/src/content/specs/${entry.file}`}
          className="border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
        >
          Edit on GitHub →
        </a>
      </div>
    </PageShell>
  );
}
