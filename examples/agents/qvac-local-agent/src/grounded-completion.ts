import { completion } from '@qvac/sdk';
import type { BriefChunk } from './rag.js';

export type GroundedResult = {
  output: string;
  groundingChunks: BriefChunk[];
};

export async function runGroundedCompletion(opts: {
  llmId: string;
  taskPrompt: string;
  groundingChunks: BriefChunk[];
  systemPrompt?: string;
}): Promise<GroundedResult> {
  const groundingBlock = opts.groundingChunks.length === 0
    ? 'No grounding capabilities matched. Decline the task in one sentence.'
    : opts.groundingChunks
        .map((c, i) => `[${i + 1}] (relevance ${c.score.toFixed(3)})\n${c.content}`)
        .join('\n\n---\n\n');

  const system =
    opts.systemPrompt ??
    'You are an autonomous agent on the Solana Agent Economy Protocol. ' +
      'Only do work covered by the capabilities listed below. ' +
      'If the task is outside those capabilities, decline in one sentence and stop. ' +
      'Otherwise produce the output exactly as the matching capability specifies.';

  const userMessage =
    `# Capabilities you can act under\n\n${groundingBlock}\n\n` +
    `# Task brief\n\n${opts.taskPrompt}\n\n` +
    `# Output\n\nProduce the output now. Do not echo this prompt.`;

  const result = completion({
    modelId: opts.llmId,
    history: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
    stream: true,
  } as Parameters<typeof completion>[0]);

  let out = '';
  for await (const token of result.tokenStream) {
    out += token;
    process.stderr.write(token);
  }
  process.stderr.write('\n');
  if (out.length === 0) {
    const fallback = await result.text;
    out = fallback;
  }
  return { output: out.trim(), groundingChunks: opts.groundingChunks };
}
