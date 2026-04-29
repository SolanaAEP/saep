// Smoke test: builds a real Groth16 proof for a fabricated brief+output pair
// and locally verifies it against the dev SRS verification key. Run after
// `circuits/task_completion/scripts/{compile,setup}.sh` have produced
// build/task_completion.zkey + verification_key.json.

import {
  artifactsAvailable,
  buildTaskCompletionProof,
  defaultCircuitArtifacts,
  paddedCircuitLabel,
  proofToTaskMarketBytes,
  resultHashBytes,
  verifyProofLocally,
} from '../src/proof.js';

const BRIEF = 'Triage a Solana lending protocol oracle staleness incident. Operator exposure: 400k.';
const OUTPUT =
  'Severity: High. Blast radius: one isolated pool drained, ~3.2M total. ' +
  'Mitigation: pool paused, oracle source rotated. Operator exposure: 400k stranded. ' +
  'Recommended action: withdraw remaining position when withdrawals re-open and switch oracle.';

async function main() {
  const artifacts = defaultCircuitArtifacts();
  if (!artifactsAvailable(artifacts)) {
    console.error('[proof-smoke] artifacts missing.');
    console.error(`  expected wasm: ${artifacts.wasm}`);
    console.error('  run: cd circuits/task_completion && bash scripts/compile.sh && bash scripts/setup.sh');
    process.exit(1);
  }

  const t0 = Date.now();
  const result = await buildTaskCompletionProof({
    brief: BRIEF,
    output: OUTPUT,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  });
  const tProve = Date.now() - t0;

  const valid = await verifyProofLocally(result.proof, result.publicSignals, artifacts);
  const tVerify = Date.now() - t0 - tProve;

  const proofBytes = proofToTaskMarketBytes(result.proof);
  const proofKey = paddedCircuitLabel();
  const resultHash = resultHashBytes(result.publicInputs.resultHash);

  console.log(`[proof-smoke] prove: ${tProve}ms  verify: ${tVerify}ms  valid=${valid}`);
  console.log(`[proof-smoke] taskHash    = ${result.publicInputs.taskHash.toString().slice(0, 24)}..`);
  console.log(`[proof-smoke] resultHash  = ${result.publicInputs.resultHash.toString().slice(0, 24)}..`);
  console.log(`[proof-smoke] criteriaRt  = ${result.publicInputs.criteriaRoot.toString().slice(0, 24)}..`);
  console.log(`[proof-smoke] resultHash bytes = ${Buffer.from(resultHash).toString('hex').slice(0, 24)}..`);
  console.log(`[proof-smoke] proofKey label   = ${Buffer.from(proofKey).toString('utf8').replace(/\0+$/, '')}`);
  console.log(`[proof-smoke] proofA len = ${proofBytes.proofA.length} (expect 64)`);
  console.log(`[proof-smoke] proofB len = ${proofBytes.proofB.length} (expect 128)`);
  console.log(`[proof-smoke] proofC len = ${proofBytes.proofC.length} (expect 64)`);

  if (!valid) {
    console.error('[proof-smoke] proof failed local verification');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[proof-smoke] failed:', err);
  process.exit(1);
});
