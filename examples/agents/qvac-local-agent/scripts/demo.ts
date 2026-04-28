import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExecutionCommitment } from '../src/commitment.js';
import {
  buildCapabilityVector,
  scoreTaskAgainstCapabilities,
} from '../src/capability.js';
import { runGroundedCompletion } from '../src/grounded-completion.js';
import { ingestBriefs, searchBriefs } from '../src/rag.js';
import { startRuntime } from '../src/qvac-runtime.js';

const SAMPLE_TASKS = [
  {
    title: 'Governance digest',
    prompt:
      'Digest the proposed Pyth oracle integration upgrade against our voting policy of "no inflation increases unless TVL/inflation > 50x." Tone: executive.',
  },
  {
    title: 'Security triage',
    prompt:
      'Triage this incident: a Solana lending protocol reports an oracle staleness exploit drained $3.2M from one isolated pool. Operator exposure: we hold $400k in the affected pool. Time horizon: urgent.',
  },
  {
    title: 'Out-of-domain',
    prompt:
      'Write me a haiku about quantum computing in iambic pentameter.',
  },
];

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const briefsDir = join(here, '..', 'briefs');

  console.log('[demo] starting QVAC runtime — first run downloads ~1.1GB of GGUFs');
  const rt = await startRuntime();
  console.log(`[demo] models loaded: llm=${rt.llmId} embed=${rt.embedId}`);

  const ingest = await ingestBriefs({ embedId: rt.embedId, briefsDir });
  console.log(`[demo] ingested ${ingest.ingested} briefs (${ingest.skipped} skipped)\n`);

  const capability = await buildCapabilityVector({
    embedId: rt.embedId,
    briefSummary:
      'DeFi position summary, governance proposal digest, security incident triage, ' +
      'protocol research snapshot, treasury rebalance memo. Solana, on-chain agents, ' +
      'private operating context.',
  });

  for (const task of SAMPLE_TASKS) {
    console.log(`\n${'='.repeat(72)}\n[task] ${task.title}\n${'-'.repeat(72)}`);
    console.log(`prompt: ${task.prompt}\n`);

    const score = await scoreTaskAgainstCapabilities({
      embedId: rt.embedId,
      taskPrompt: task.prompt,
      capability,
    });
    console.log(`capability score: ${score.toFixed(3)}`);

    if (score < 0.35) {
      console.log('[result] below capability threshold — agent declines');
      continue;
    }

    const grounding = await searchBriefs({ embedId: rt.embedId, query: task.prompt, topK: 3 });
    console.log(
      `grounding: ${grounding.length} chunks, top score ${grounding[0]?.score.toFixed(3) ?? 'n/a'}`,
    );

    const { output } = await runGroundedCompletion({
      llmId: rt.llmId,
      taskPrompt: task.prompt,
      groundingChunks: grounding,
    });

    const taskHash = Uint8Array.from(randomBytes(32));
    const commitment = buildExecutionCommitment({
      taskHash,
      output,
      llmSrc: rt.llmSrc,
      embedSrc: rt.embedSrc,
    });

    console.log(`\n[output]\n${output}\n`);
    console.log(`[commitment] resultHash=${commitment.preimage.resultHashHex.slice(0, 16)}..`);
    console.log(`[commitment] proofKey  =${Buffer.from(commitment.proofKey).toString('hex').slice(0, 16)}..`);
  }

  await rt.close();
  console.log('\n[demo] complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
