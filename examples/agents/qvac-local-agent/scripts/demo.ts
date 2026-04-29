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
import {
  artifactsAvailable,
  buildTaskCompletionProof,
  defaultCircuitArtifacts,
  paddedCircuitLabel,
  proofToTaskMarketBytes,
  resultHashBytes,
  verifyProofLocally,
} from '../src/proof.js';

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

  const artifacts = defaultCircuitArtifacts();
  const haveArtifacts = artifactsAvailable(artifacts);
  if (haveArtifacts) {
    console.log(`[demo] task_completion circuit artifacts loaded — real Groth16 proofs enabled`);
  } else {
    console.log(`[demo] circuit artifacts missing at ${artifacts.wasm}`);
    console.log(`[demo] falling back to commitment-hash mode. Run circuits/task_completion/scripts/{compile,setup}.sh to enable real proofs.`);
  }

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

    console.log(`\n[output]\n${output}\n`);

    if (haveArtifacts) {
      const tStart = Date.now();
      const proven = await buildTaskCompletionProof({
        brief: task.prompt,
        output,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        artifacts,
      });
      const proveMs = Date.now() - tStart;
      const valid = await verifyProofLocally(proven.proof, proven.publicSignals, artifacts);
      const onChainProofKey = paddedCircuitLabel();
      const onChainResultHash = resultHashBytes(proven.publicInputs.resultHash);
      const proofBytes = proofToTaskMarketBytes(proven.proof);
      console.log(`[proof] groth16 fullProve ${proveMs}ms — verified locally: ${valid}`);
      console.log(`[proof] taskHash    = ${proven.publicInputs.taskHash.toString().slice(0, 24)}..`);
      console.log(`[proof] resultHash  = ${proven.publicInputs.resultHash.toString().slice(0, 24)}..`);
      console.log(`[proof] criteriaRt  = ${proven.publicInputs.criteriaRoot.toString().slice(0, 24)}..`);
      console.log(`[onchain] resultHash bytes = ${Buffer.from(onChainResultHash).toString('hex').slice(0, 16)}..`);
      console.log(`[onchain] proofKey label   = ${Buffer.from(onChainProofKey).toString('utf8').replace(/\0+$/, '')}`);
      console.log(`[onchain] proofA/B/C bytes = ${proofBytes.proofA.length}/${proofBytes.proofB.length}/${proofBytes.proofC.length}`);
    } else {
      const taskHash = Uint8Array.from(randomBytes(32));
      const commitment = buildExecutionCommitment({
        taskHash,
        output,
        llmSrc: rt.llmSrc,
        embedSrc: rt.embedSrc,
      });
      console.log(`[commitment] resultHash=${commitment.preimage.resultHashHex.slice(0, 16)}..`);
      console.log(`[commitment] proofKey  =${Buffer.from(commitment.proofKey).toString('hex').slice(0, 16)}..`);
    }
  }

  await rt.close();
  console.log('\n[demo] complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
