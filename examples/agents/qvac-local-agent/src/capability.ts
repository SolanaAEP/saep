import { embed } from '@qvac/sdk';

export type CapabilityVector = {
  embedding: number[];
  source: string;
};

function l2Norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  const denom = l2Norm(a) * l2Norm(b);
  return denom === 0 ? 0 : dot / denom;
}

export async function embedText(opts: {
  embedId: string;
  text: string;
}): Promise<number[]> {
  const result = await embed({ modelId: opts.embedId, text: opts.text });
  const v = result.embedding;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'number') {
    return v as number[];
  }
  if (Array.isArray(v) && Array.isArray(v[0])) {
    return v[0] as number[];
  }
  throw new Error('unexpected embedding shape');
}

export async function buildCapabilityVector(opts: {
  embedId: string;
  briefSummary: string;
}): Promise<CapabilityVector> {
  const embedding = await embedText({ embedId: opts.embedId, text: opts.briefSummary });
  return { embedding, source: opts.briefSummary };
}

export async function scoreTaskAgainstCapabilities(opts: {
  embedId: string;
  taskPrompt: string;
  capability: CapabilityVector;
}): Promise<number> {
  const taskVec = await embedText({ embedId: opts.embedId, text: opts.taskPrompt });
  return cosineSimilarity(taskVec, opts.capability.embedding);
}
