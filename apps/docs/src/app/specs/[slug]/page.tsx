import { notFound } from 'next/navigation';
import { marked } from 'marked';
import { listSpecs, readSpec } from '@/lib/specs';

export function generateStaticParams() {
  return listSpecs().map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const spec = readSpec(slug);
  return { title: spec ? `${spec.title} · SAEP Docs` : 'SAEP Docs' };
}

export default async function SpecPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const spec = readSpec(slug);
  if (!spec) notFound();
  const html = await marked.parse(spec.body, { async: true });
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
