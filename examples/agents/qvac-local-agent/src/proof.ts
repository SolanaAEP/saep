import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — snarkjs ships no types
import * as snarkjs from 'snarkjs';
import {
  criteriaMerkleProof,
  poseidonSponge,
  RESULT_TAG,
  TASK_TAG,
  textToFieldElements,
} from './poseidon.js';

export const TASK_COMPLETION_CIRCUIT_LABEL = 'task_completion_v1';
export const N_TASK = 16;
export const N_RESULT = 32;

export type CircuitArtifacts = {
  wasm: string;
  zkey: string;
  vk: string;
};

export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: string;
}

export interface ProofGenResult {
  proof: Groth16Proof;
  publicSignals: [string, string, string, string, string];
  publicInputs: {
    taskHash: bigint;
    resultHash: bigint;
    deadline: bigint;
    submittedAt: bigint;
    criteriaRoot: bigint;
  };
  privateInputs: {
    taskPreimage: bigint[];
    resultPreimage: bigint[];
    salt: bigint;
    criteriaSatisfied: bigint[];
    criteriaPath: bigint[];
    criteriaIndex: bigint[];
  };
}

export interface BuildProofOptions {
  brief: string;
  output: string;
  deadline: bigint | number;
  submittedAt?: bigint | number;
  salt?: bigint;
  criteriaSatisfied?: bigint[];
  artifacts?: CircuitArtifacts;
}

function defaultArtifacts(): CircuitArtifacts {
  const here = dirname(fileURLToPath(import.meta.url));
  // examples/agents/qvac-local-agent/src/ → ../../../circuits/task_completion/build
  const buildDir =
    process.env.SAEP_CIRCUIT_BUILD_DIR ??
    resolve(here, '..', '..', '..', '..', 'circuits', 'task_completion', 'build');
  return {
    wasm: resolve(buildDir, 'task_completion_js', 'task_completion.wasm'),
    zkey: resolve(buildDir, 'task_completion.zkey'),
    vk: resolve(buildDir, 'verification_key.json'),
  };
}

export function artifactsAvailable(artifacts = defaultArtifacts()): boolean {
  return existsSync(artifacts.wasm) && existsSync(artifacts.zkey) && existsSync(artifacts.vk);
}

export function defaultCircuitArtifacts(): CircuitArtifacts {
  return defaultArtifacts();
}

function randomSalt(): bigint {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let v = 0n;
  for (const byte of buf) v = (v << 8n) | BigInt(byte);
  return v;
}

export async function buildTaskCompletionProof(opts: BuildProofOptions): Promise<ProofGenResult> {
  const artifacts = opts.artifacts ?? defaultArtifacts();
  if (!artifactsAvailable(artifacts)) {
    throw new Error(
      `task_completion circuit artifacts missing at ${artifacts.wasm}. ` +
        'Run circuits/task_completion/scripts/{compile.sh,setup.sh} first.',
    );
  }

  const taskPreimage = textToFieldElements(opts.brief, N_TASK);
  const resultPreimage = textToFieldElements(opts.output, N_RESULT);
  const salt = opts.salt ?? randomSalt();
  const criteriaSatisfied = opts.criteriaSatisfied ?? Array(8).fill(1n);
  if (criteriaSatisfied.length !== 8) {
    throw new Error('criteriaSatisfied must have length 8');
  }

  const taskHash = await poseidonSponge(TASK_TAG, [salt, ...taskPreimage]);
  const resultHash = await poseidonSponge(RESULT_TAG, resultPreimage);
  const merkle = await criteriaMerkleProof(criteriaSatisfied);

  const deadline = BigInt(opts.deadline);
  const submittedAt = BigInt(opts.submittedAt ?? Math.floor(Date.now() / 1000));
  if (submittedAt > deadline) {
    throw new Error('submittedAt must be <= deadline (circuit constraint)');
  }

  const witness = {
    task_hash: taskHash.toString(),
    result_hash: resultHash.toString(),
    deadline: deadline.toString(),
    submitted_at: submittedAt.toString(),
    criteria_root: merkle.root.toString(),
    task_preimage: taskPreimage.map((b) => b.toString()),
    result_preimage: resultPreimage.map((b) => b.toString()),
    salt: salt.toString(),
    criteria_satisfied: criteriaSatisfied.map((b) => b.toString()),
    criteria_path: merkle.path.map((b) => b.toString()),
    criteria_index: merkle.index.map((b) => b.toString()),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    witness,
    artifacts.wasm,
    artifacts.zkey,
  );

  return {
    proof,
    publicSignals: publicSignals as ProofGenResult['publicSignals'],
    publicInputs: {
      taskHash,
      resultHash,
      deadline,
      submittedAt,
      criteriaRoot: merkle.root,
    },
    privateInputs: {
      taskPreimage,
      resultPreimage,
      salt,
      criteriaSatisfied,
      criteriaPath: merkle.path,
      criteriaIndex: merkle.index,
    },
  };
}

export async function verifyProofLocally(
  proof: Groth16Proof,
  publicSignals: readonly string[],
  artifacts = defaultArtifacts(),
): Promise<boolean> {
  const { readFile } = await import('node:fs/promises');
  const vkRaw = await readFile(artifacts.vk, 'utf8');
  const vk = JSON.parse(vkRaw);
  return snarkjs.groth16.verify(vk, publicSignals as string[], proof) as Promise<boolean>;
}

export function paddedCircuitLabel(label = TASK_COMPLETION_CIRCUIT_LABEL): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = new TextEncoder().encode(label);
  out.set(bytes.slice(0, 32));
  return out;
}

function fieldToBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('field must be non-negative');
  const out = new Uint8Array(32);
  let cursor = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(cursor & 0xffn);
    cursor >>= 8n;
  }
  if (cursor !== 0n) throw new Error('field exceeds 32 bytes');
  return out;
}

export function resultHashBytes(resultHash: bigint): Uint8Array {
  return fieldToBytes(resultHash);
}

function g1ToBytes(point: readonly [string, string, string]): Uint8Array {
  const out = new Uint8Array(64);
  out.set(fieldToBytes(BigInt(point[0])), 0);
  out.set(fieldToBytes(BigInt(point[1])), 32);
  return out;
}

function g2ToBytes(
  point: readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ],
): Uint8Array {
  const out = new Uint8Array(128);
  // Solana bn254 expects (x.c1, x.c0, y.c1, y.c0) — same as sdk-ui helper.
  out.set(fieldToBytes(BigInt(point[0][1])), 0);
  out.set(fieldToBytes(BigInt(point[0][0])), 32);
  out.set(fieldToBytes(BigInt(point[1][1])), 64);
  out.set(fieldToBytes(BigInt(point[1][0])), 96);
  return out;
}

export function proofToTaskMarketBytes(proof: Groth16Proof): {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
} {
  return {
    proofA: g1ToBytes(proof.pi_a),
    proofB: g2ToBytes(proof.pi_b),
    proofC: g1ToBytes(proof.pi_c),
  };
}
