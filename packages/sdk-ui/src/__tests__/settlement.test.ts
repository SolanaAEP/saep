import { describe, expect, it } from 'vitest';
import {
  TASK_COMPLETION_CIRCUIT_ID,
  TASK_COMPLETION_CIRCUIT_LABEL,
  TASK_COMPLETION_PUBLIC_INPUTS,
  bytesToHex,
  deriveTaskCompletionProofKey,
  evaluateSettlementReadiness,
  groth16ProofToTaskMarketProofBytes,
  parseTaskCompletionWitnessJson,
  computeTaskCompletionVkId,
  type SettlementReadinessInputs,
} from '../settlement.js';

const TASK_MARKET = 'HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w';
const EXPECTED_VK = '8eTYZ9QNHt6UbTqQJX2qG2eywnwMtjhKNveWnFj5kFVD';

function readyInput(): SettlementReadinessInputs {
  return {
    taskMarketProgramId: TASK_MARKET,
    expectedVerifierKeyAddress: EXPECTED_VK,
    market: { paused: false },
    verifierMode: { isMainnet: true },
    verifierConfig: { paused: false, activeVk: EXPECTED_VK },
    activeVerifierKey: {
      address: EXPECTED_VK,
      isProduction: true,
      circuitLabel: TASK_COMPLETION_CIRCUIT_LABEL,
      numPublicInputs: TASK_COMPLETION_PUBLIC_INPUTS.length,
    },
    allowedCallers: { programs: [TASK_MARKET] },
    proofGenHealth: {
      ok: true,
      artifacts: 'loaded',
      verification_key: 'present',
      circuits: [TASK_COMPLETION_CIRCUIT_ID],
    },
    proofGenCircuits: {
      circuits: [
        {
          circuit_id: TASK_COMPLETION_CIRCUIT_ID,
          lifecycle: 'live',
          verifier: 'groth16-bn254',
          artifacts: 'loaded',
          verification_key: 'present',
          public_inputs: [...TASK_COMPLETION_PUBLIC_INPUTS],
        },
      ],
    },
  };
}

describe('settlement proof helpers', () => {
  it('derives stable proof keys and verifier-key IDs', async () => {
    const proofKey = await deriveTaskCompletionProofKey({
      taskId: new Uint8Array(32).fill(1),
      resultHash: new Uint8Array(32).fill(2),
    });
    const vkId = await computeTaskCompletionVkId();

    expect(bytesToHex(proofKey)).toBe('883438fce18f9c9b68a66ef0bc10de5da78d26875cc70e44f59bcfa0cb716c10');
    expect(bytesToHex(vkId)).toBe('b43ee0cd5bac7d014d513f518e4578731ac7e837e33b1d621c906aac5fda09ad');
  });

  it('converts snarkjs Groth16 points to task_market byte layout', () => {
    const converted = groth16ProofToTaskMarketProofBytes({
      pi_a: ['1', '2', '1'],
      pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
      pi_c: ['7', '8', '1'],
    });

    expect(converted.proofA).toHaveLength(64);
    expect(converted.proofB).toHaveLength(128);
    expect(converted.proofC).toHaveLength(64);
    expect(converted.proofA[31]).toBe(1);
    expect(converted.proofA[63]).toBe(2);
    expect(converted.proofB[31]).toBe(4);
    expect(converted.proofB[63]).toBe(3);
    expect(converted.proofB[95]).toBe(6);
    expect(converted.proofB[127]).toBe(5);
  });

  it('validates v1 witness JSON shape', () => {
    const witness = {
      task_preimage: Array.from({ length: 16 }, (_, i) => String(i)),
      result_preimage: Array.from({ length: 32 }, (_, i) => `0x${i.toString(16)}`),
      salt: '9',
      criteria_satisfied: Array.from({ length: 8 }, () => '1'),
      criteria_path: Array.from({ length: 3 }, () => '0'),
      criteria_index: Array.from({ length: 3 }, () => '0'),
    };

    expect(parseTaskCompletionWitnessJson(JSON.stringify(witness))).toEqual(witness);
    expect(() => parseTaskCompletionWitnessJson('{"task_preimage":[]}')).toThrow('task_preimage');
  });
});

describe('evaluateSettlementReadiness', () => {
  it('passes when verifier, caller, and proof-gen artifacts line up', () => {
    expect(evaluateSettlementReadiness(readyInput()).ready).toBe(true);
  });

  it('rejects a missing or non-production active verifier key', () => {
    const missing = readyInput();
    missing.activeVerifierKey = null;
    expect(evaluateSettlementReadiness(missing).ready).toBe(false);
    expect(evaluateSettlementReadiness(missing).checks.find((check) => check.key === 'active-vk')?.ok).toBe(false);

    const devOnly = readyInput();
    devOnly.activeVerifierKey = { ...devOnly.activeVerifierKey!, isProduction: false };
    expect(evaluateSettlementReadiness(devOnly).ready).toBe(false);
    expect(evaluateSettlementReadiness(devOnly).checks.find((check) => check.key === 'production-vk')?.ok).toBe(false);
  });

  it('rejects paused verifier, missing caller, and missing proof-gen artifacts', () => {
    const paused = readyInput();
    paused.verifierConfig = { paused: true, activeVk: EXPECTED_VK };
    expect(evaluateSettlementReadiness(paused).checks.find((check) => check.key === 'verifier-config')?.ok).toBe(false);

    const noCaller = readyInput();
    noCaller.allowedCallers = { programs: [] };
    expect(evaluateSettlementReadiness(noCaller).checks.find((check) => check.key === 'allowed-caller')?.ok).toBe(false);

    const noArtifacts = readyInput();
    noArtifacts.proofGenHealth = { ok: false, artifacts: 'missing', verification_key: 'missing' };
    expect(evaluateSettlementReadiness(noArtifacts).checks.find((check) => check.key === 'proofgen-health')?.ok).toBe(false);
  });
});
