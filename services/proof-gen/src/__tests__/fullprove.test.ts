import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as snarkjs from 'snarkjs';

const ARTIFACTS_DIR = resolve(
  import.meta.dirname,
  '..', '..', '..', '..', 'circuits', 'task_completion', 'build',
);
const WASM = resolve(ARTIFACTS_DIR, 'task_completion_js', 'task_completion.wasm');
const ZKEY = resolve(ARTIFACTS_DIR, 'task_completion.zkey');
const VK = JSON.parse(readFileSync(resolve(ARTIFACTS_DIR, 'verification_key.json'), 'utf8'));
const FIXTURE = JSON.parse(
  readFileSync(
    resolve(ARTIFACTS_DIR, '..', 'inputs', 'sample_input.json'),
    'utf8',
  ),
);

describe('fullProve e2e with real artifacts', () => {
  it('generates a valid proof from fixture input', async () => {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(FIXTURE, WASM, ZKEY);

    expect(publicSignals).toHaveLength(5);
    expect(publicSignals[0]).toBe(FIXTURE.task_hash);
    expect(publicSignals[1]).toBe(FIXTURE.result_hash);
    expect(publicSignals[2]).toBe(FIXTURE.deadline);
    expect(publicSignals[3]).toBe(FIXTURE.submitted_at);
    expect(publicSignals[4]).toBe(FIXTURE.criteria_root);

    const valid = await snarkjs.groth16.verify(VK, publicSignals, proof);
    expect(valid).toBe(true);
  }, 30_000);

  it('rejects tampered public signals', async () => {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(FIXTURE, WASM, ZKEY);

    const tampered = [...publicSignals];
    tampered[0] = '999';

    const valid = await snarkjs.groth16.verify(VK, tampered, proof);
    expect(valid).toBe(false);
  }, 30_000);
});
