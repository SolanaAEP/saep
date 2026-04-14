import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SPECS_DIR = join(process.cwd(), '..', '..', 'specs');

export type SpecEntry = {
  slug: string;
  file: string;
  title: string;
  group: 'protocol' | 'ops';
  order: number;
};

function titleFromMarkdown(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m && m[1] ? m[1].replace(/[\s—-]+$/g, '').trim() : fallback;
}

export function listSpecs(): SpecEntry[] {
  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.md'));
  const entries = files.map((file) => {
    const body = readFileSync(join(SPECS_DIR, file), 'utf8');
    const slug = file.replace(/\.md$/, '');
    const group: SpecEntry['group'] = slug.startsWith('ops-') ? 'ops' : 'protocol';
    const numMatch = slug.match(/^(\d+)/);
    const order = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : 1000;
    return {
      slug,
      file,
      title: titleFromMarkdown(body, slug),
      group,
      order,
    };
  });
  return entries.sort((a, b) => {
    if (a.group !== b.group) return a.group === 'protocol' ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.slug.localeCompare(b.slug);
  });
}

export function readSpec(slug: string): { body: string; title: string } | null {
  const entries = listSpecs();
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) return null;
  const body = readFileSync(join(SPECS_DIR, entry.file), 'utf8');
  return { body, title: entry.title };
}
