import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ragIngest, ragSearch, type RagSearchResult } from '@qvac/sdk';

export const WORKSPACE = 'saep-qvac-agent';

export type BriefChunk = {
  id: string;
  content: string;
  score: number;
};

export async function ingestBriefs(opts: {
  embedId: string;
  briefsDir: string;
}): Promise<{ ingested: number; skipped: number }> {
  const files = readdirSync(opts.briefsDir).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    return { ingested: 0, skipped: 0 };
  }
  const documents = files.map((f) => readFileSync(join(opts.briefsDir, f), 'utf8'));

  const result = await ragIngest({
    workspace: WORKSPACE,
    modelId: opts.embedId,
    documents,
    chunk: true,
    chunkOpts: { chunkSize: 400, chunkOverlap: 60, chunkStrategy: 'paragraph' },
  });

  let ingested = 0;
  let skipped = 0;
  for (const r of result.processed) {
    if (r.status === 'fulfilled') ingested += 1;
    else skipped += 1;
  }
  return { ingested, skipped };
}

export async function searchBriefs(opts: {
  embedId: string;
  query: string;
  topK?: number;
}): Promise<BriefChunk[]> {
  const results = await ragSearch({
    workspace: WORKSPACE,
    modelId: opts.embedId,
    query: opts.query,
    topK: opts.topK ?? 4,
  });
  return results.map((r: RagSearchResult) => ({ id: r.id, content: r.content, score: r.score }));
}
