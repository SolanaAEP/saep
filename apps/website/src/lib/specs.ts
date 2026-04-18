import { promises as fs } from 'node:fs';
import path from 'node:path';
import { specBySlug, specIndex, type SpecEntry } from '@/content/spec-index';

const contentDir = path.join(process.cwd(), 'src', 'content', 'specs');

export async function loadSpec(slug: string): Promise<{ entry: SpecEntry; body: string } | null> {
  const entry = specBySlug.get(slug);
  if (!entry) return null;
  const body = await fs.readFile(path.join(contentDir, entry.file), 'utf8');
  return { entry, body: stripLeadingHeading(body) };
}

function stripLeadingHeading(md: string): string {
  const lines = md.split('\n');
  if (lines[0]?.startsWith('# ')) return lines.slice(1).join('\n').replace(/^\n+/, '');
  return md;
}

export function allSpecSlugs(): string[] {
  return specIndex.map((s) => s.slug);
}
