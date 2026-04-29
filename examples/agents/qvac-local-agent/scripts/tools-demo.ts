// Demo: an agent that uses QVAC native tool-calling to invoke @saep/sdk
// fetchers during reasoning. The model decides to call fetch_agent or
// fetch_task, the runtime executes via stub handlers (or live ones if you
// provide a provider), and the model produces a final grounded answer.

import { loadToolModel, runWithTools } from '../src/grounded-tool-completion.js';
import { stubHandlers } from '../src/saep-tools.js';

const SAMPLE_PROMPT =
  'I need to know whether agent did 0xabc123de4f56789ab1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f6071829 ' +
  'is currently active and how many jobs it has completed. If it has ' +
  'fewer than 50 jobs, recommend we wait. If 50 or more, recommend we use it.';

async function main() {
  console.log('[tools-demo] loading tool-calling LLM (Llama-3.2-1B tool-calling Q4)');
  const { modelId, close } = await loadToolModel();

  try {
    const handlers = stubHandlers();
    const tStart = Date.now();
    const { finalOutput, toolCalls, rounds } = await runWithTools({
      modelId,
      taskPrompt: SAMPLE_PROMPT,
      handlers,
      maxRounds: 2,
    });
    const elapsed = Date.now() - tStart;

    console.log(`\n${'='.repeat(72)}`);
    console.log(`[tools-demo] rounds=${rounds} elapsed=${elapsed}ms`);
    console.log(`[tools-demo] tool calls observed: ${toolCalls.length}`);
    for (const c of toolCalls) {
      const args = typeof c.arguments === 'object' ? JSON.stringify(c.arguments) : String(c.arguments);
      console.log(`  → ${c.name}(${args})`);
      if (c.result && typeof c.result === 'object') {
        const r = c.result as { ok?: boolean; result?: unknown; error?: string };
        if (r.ok) console.log(`    result: ${JSON.stringify(r.result)}`);
        else console.log(`    error: ${r.error}`);
      }
    }
    console.log(`\n[tools-demo] final answer:\n${finalOutput}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('[tools-demo] failed:', err);
  process.exit(1);
});
