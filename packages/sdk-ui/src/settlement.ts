'use client';

import type { TaskDetail } from '@saep/sdk';

export const TASK_COMPLETION_CIRCUIT_ID = 'task_completion.v1';
export const TASK_COMPLETION_CIRCUIT_LABEL = 'task_completion_v1';
export const TASK_COMPLETION_PUBLIC_INPUTS = [
  'task_hash',
  'result_hash',
  'deadline',
  'submitted_at',
  'criteria_root',
] as const;

export type TaskCompletionPublicInputs = {
  task_hash: string;
  result_hash: string;
  deadline: string;
  submitted_at: string;
  criteria_root: string;
};

export type TaskCompletionPrivateInputs = {
  task_preimage: string[];
  result_preimage: string[];
  salt: string;
  criteria_satisfied: string[];
  criteria_path: string[];
  criteria_index: string[];
};

export type TaskCompletionProofGenRequest = {
  circuit_id: typeof TASK_COMPLETION_CIRCUIT_ID;
  public_inputs: TaskCompletionPublicInputs;
  private_inputs: TaskCompletionPrivateInputs;
};

export interface Groth16ProofLike {
  pi_a: readonly [string, string, string];
  pi_b: readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ];
  pi_c: readonly [string, string, string];
}

export interface TaskMarketProofBytes {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
}

export interface ProofGenCircuitSummary {
  circuit_id: string;
  slug?: string;
  lifecycle?: string;
  verifier?: string;
  verification_key_version?: number;
  public_inputs?: string[];
  artifacts?: string;
  verification_key?: string;
}

export interface SettlementReadinessInputs {
  taskMarketProgramId: string;
  expectedVerifierKeyAddress: string;
  market: { paused: boolean; proofVerifier?: string | null } | null;
  verifierMode: { isMainnet: boolean } | null;
  verifierConfig: { paused: boolean; activeVk: string | null } | null;
  activeVerifierKey: {
    address: string;
    isProduction: boolean;
    circuitLabel: string | Uint8Array;
    numPublicInputs: number;
  } | null;
  allowedCallers: { programs: string[] } | null;
  proofGenHealth: {
    ok?: boolean;
    artifacts?: string;
    verification_key?: string;
    circuits?: string[];
  } | null;
  proofGenCircuits: { circuits?: ProofGenCircuitSummary[] } | null;
}

export interface SettlementReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface SettlementReadiness {
  ready: boolean;
  checks: SettlementReadinessCheck[];
}

const FIELD_RE = /^(0x[0-9a-fA-F]+|[0-9]+)$/;
const HASH32_RE = /^0x[0-9a-fA-F]{64}$/;

function concatBytes(chunks: (Uint8Array | string)[]): Uint8Array {
  const encoded = chunks.map((chunk) =>
    typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
  );
  const len = encoded.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const chunk of encoded) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string, expectedBytes?: number): Uint8Array {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('hex value must contain an even number of hexadecimal characters');
  }
  const out = Uint8Array.from(normalized.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
  if (expectedBytes != null && out.length !== expectedBytes) {
    throw new Error(`hex value must be ${expectedBytes} bytes`);
  }
  return out;
}

export function to0xHash32(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('hash must be 32 bytes');
  return `0x${bytesToHex(bytes)}`;
}

export function circuitLabelToString(label: Uint8Array | string): string {
  if (typeof label === 'string') return label.replace(/\0+$/, '');
  const zero = label.indexOf(0);
  const slice = zero === -1 ? label : label.slice(0, zero);
  return new TextDecoder().decode(slice);
}

export function paddedCircuitLabel(label = TASK_COMPLETION_CIRCUIT_LABEL): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = new TextEncoder().encode(label);
  out.set(bytes.slice(0, 32));
  return out;
}

function fieldElementToBytes(value: string | bigint): Uint8Array {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n) throw new Error('field element must be non-negative');
  const out = new Uint8Array(32);
  let cursor = n;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(cursor & 0xffn);
    cursor >>= 8n;
  }
  if (cursor !== 0n) throw new Error('field element exceeds 32 bytes');
  return out;
}

function g1ToBytes(point: readonly [string, string, string]): Uint8Array {
  return concatBytes([fieldElementToBytes(point[0]), fieldElementToBytes(point[1])]);
}

function g2ToBytes(
  point: readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ],
): Uint8Array {
  return concatBytes([
    fieldElementToBytes(point[0][1]),
    fieldElementToBytes(point[0][0]),
    fieldElementToBytes(point[1][1]),
    fieldElementToBytes(point[1][0]),
  ]);
}

export function groth16ProofToTaskMarketProofBytes(proof: Groth16ProofLike): TaskMarketProofBytes {
  return {
    proofA: g1ToBytes(proof.pi_a),
    proofB: g2ToBytes(proof.pi_b),
    proofC: g1ToBytes(proof.pi_c),
  };
}

export async function sha256Bytes(...chunks: (Uint8Array | string)[]): Promise<Uint8Array> {
  const data = concatBytes(chunks);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

export async function deriveTaskCompletionProofKey(input: {
  taskId: Uint8Array;
  resultHash: Uint8Array;
  circuitId?: string;
}): Promise<Uint8Array> {
  if (input.taskId.length !== 32) throw new Error('taskId must be 32 bytes');
  if (input.resultHash.length !== 32) throw new Error('resultHash must be 32 bytes');
  return sha256Bytes(
    'saep:task-completion:proof-key:v1',
    input.circuitId ?? TASK_COMPLETION_CIRCUIT_ID,
    input.taskId,
    input.resultHash,
  );
}

export async function computeTaskCompletionVkId(
  label = TASK_COMPLETION_CIRCUIT_LABEL,
): Promise<Uint8Array> {
  return sha256Bytes(label);
}

export function buildTaskCompletionPublicInputs(task: Pick<
  TaskDetail,
  'taskHash' | 'resultHash' | 'deadline' | 'submittedAt' | 'criteriaRoot'
>): TaskCompletionPublicInputs {
  return {
    task_hash: to0xHash32(task.taskHash),
    result_hash: to0xHash32(task.resultHash),
    deadline: String(task.deadline),
    submitted_at: String(task.submittedAt),
    criteria_root: to0xHash32(task.criteriaRoot),
  };
}

export function buildTaskCompletionProveRequest(
  task: Pick<TaskDetail, 'taskHash' | 'resultHash' | 'deadline' | 'submittedAt' | 'criteriaRoot'>,
  privateInputs: TaskCompletionPrivateInputs,
): TaskCompletionProofGenRequest {
  return {
    circuit_id: TASK_COMPLETION_CIRCUIT_ID,
    public_inputs: buildTaskCompletionPublicInputs(task),
    private_inputs: privateInputs,
  };
}

function checkFieldArray(
  obj: Record<string, unknown>,
  field: keyof TaskCompletionPrivateInputs,
  len: number,
  errors: string[],
): string[] {
  const value = obj[field];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  if (value.length !== len) {
    errors.push(`${field} must contain ${len} field elements`);
  }
  const out: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !FIELD_RE.test(entry)) {
      errors.push(`${field}[${index}] must be a decimal or 0x-prefixed field element`);
      return;
    }
    out.push(entry);
  });
  return out;
}

export function validateTaskCompletionPrivateInputs(
  value: unknown,
): { ok: true; value: TaskCompletionPrivateInputs } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['witness must be a JSON object'] };
  }
  const obj = value as Record<string, unknown>;
  const privateInputs: TaskCompletionPrivateInputs = {
    task_preimage: checkFieldArray(obj, 'task_preimage', 16, errors),
    result_preimage: checkFieldArray(obj, 'result_preimage', 32, errors),
    salt: typeof obj.salt === 'string' && FIELD_RE.test(obj.salt) ? obj.salt : '',
    criteria_satisfied: checkFieldArray(obj, 'criteria_satisfied', 8, errors),
    criteria_path: checkFieldArray(obj, 'criteria_path', 3, errors),
    criteria_index: checkFieldArray(obj, 'criteria_index', 3, errors),
  };
  if (!privateInputs.salt) errors.push('salt must be a decimal or 0x-prefixed field element');
  return errors.length === 0 ? { ok: true, value: privateInputs } : { ok: false, errors };
}

export function parseTaskCompletionWitnessJson(text: string): TaskCompletionPrivateInputs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Witness JSON is not valid JSON');
  }
  const validation = validateTaskCompletionPrivateInputs(parsed);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return validation.value;
}

function readinessCheck(
  key: string,
  label: string,
  ok: boolean,
  good: string,
  bad: string,
): SettlementReadinessCheck {
  return { key, label, ok, detail: ok ? good : bad };
}

export function evaluateSettlementReadiness(
  input: SettlementReadinessInputs,
): SettlementReadiness {
  const circuit = input.proofGenCircuits?.circuits?.find(
    (entry) => entry.circuit_id === TASK_COMPLETION_CIRCUIT_ID,
  ) ?? null;
  const publicInputsOk = Boolean(
    circuit?.public_inputs
      && circuit.public_inputs.length === TASK_COMPLETION_PUBLIC_INPUTS.length
      && TASK_COMPLETION_PUBLIC_INPUTS.every((name, index) => circuit.public_inputs?.[index] === name),
  );
  const activeVkMatches =
    Boolean(input.verifierConfig?.activeVk)
    && Boolean(input.activeVerifierKey?.address)
    && input.verifierConfig?.activeVk === input.activeVerifierKey?.address
    && input.verifierConfig?.activeVk === input.expectedVerifierKeyAddress;

  const checks = [
    readinessCheck(
      'market',
      'MarketGlobal',
      Boolean(input.market && !input.market.paused),
      'MarketGlobal is initialized and unpaused.',
      input.market ? 'MarketGlobal is paused.' : 'MarketGlobal is missing.',
    ),
    readinessCheck(
      'mode',
      'Mainnet mode',
      Boolean(input.verifierMode?.isMainnet),
      'Proof verifier is in mainnet mode.',
      input.verifierMode ? 'Proof verifier is not in mainnet mode.' : 'Proof verifier mode is missing.',
    ),
    readinessCheck(
      'verifier-config',
      'Verifier config',
      Boolean(input.verifierConfig && !input.verifierConfig.paused),
      'Verifier config is initialized and unpaused.',
      input.verifierConfig ? 'Verifier config is paused.' : 'Verifier config is missing.',
    ),
    readinessCheck(
      'active-vk',
      'Active VK',
      activeVkMatches,
      'Active VK matches task_completion.v1.',
      input.activeVerifierKey
        ? 'Active VK does not match task_completion.v1.'
        : 'Active task_completion.v1 VK is missing.',
    ),
    readinessCheck(
      'production-vk',
      'Production VK',
      Boolean(input.activeVerifierKey?.isProduction),
      'Active VK is marked production.',
      'Active VK is not marked production.',
    ),
    readinessCheck(
      'circuit-label',
      'Circuit label',
      circuitLabelToString(input.activeVerifierKey?.circuitLabel ?? '') === TASK_COMPLETION_CIRCUIT_LABEL,
      `Circuit label is ${TASK_COMPLETION_CIRCUIT_LABEL}.`,
      `Circuit label must be ${TASK_COMPLETION_CIRCUIT_LABEL}.`,
    ),
    readinessCheck(
      'allowed-caller',
      'Allowed caller',
      Boolean(input.allowedCallers?.programs.includes(input.taskMarketProgramId)),
      'task_market is allowed to call proof_verifier.',
      'task_market is not in proof_verifier allowed callers.',
    ),
    readinessCheck(
      'proofgen-health',
      'Proof-gen health',
      Boolean(
        input.proofGenHealth?.ok
          && input.proofGenHealth.artifacts === 'loaded'
          && input.proofGenHealth.verification_key === 'present',
      ),
      'Proof-gen is healthy with artifacts loaded.',
      'Proof-gen is unavailable or missing artifacts.',
    ),
    readinessCheck(
      'proofgen-circuit',
      'Proof-gen circuit',
      Boolean(
        circuit
          && circuit.lifecycle === 'live'
          && circuit.verifier === 'groth16-bn254'
          && circuit.artifacts === 'loaded'
          && circuit.verification_key === 'present'
          && publicInputsOk,
      ),
      'Hosted task_completion.v1 circuit is live and loaded.',
      'Hosted task_completion.v1 circuit is missing, stale, or incomplete.',
    ),
    readinessCheck(
      'public-inputs',
      'Public inputs',
      Boolean(input.activeVerifierKey?.numPublicInputs === TASK_COMPLETION_PUBLIC_INPUTS.length && publicInputsOk),
      'Verifier key and proof-gen agree on public inputs.',
      'Verifier key and proof-gen public inputs differ.',
    ),
  ];

  return { ready: checks.every((check) => check.ok), checks };
}

export function validateProofPublicInputs(publicInputs: TaskCompletionPublicInputs): string[] {
  const errors: string[] = [];
  if (!HASH32_RE.test(publicInputs.task_hash)) errors.push('task_hash must be a 0x-prefixed 32-byte hash');
  if (!HASH32_RE.test(publicInputs.result_hash)) errors.push('result_hash must be a 0x-prefixed 32-byte hash');
  if (!/^[0-9]+$/.test(publicInputs.deadline)) errors.push('deadline must be a decimal timestamp');
  if (!/^[0-9]+$/.test(publicInputs.submitted_at)) errors.push('submitted_at must be a decimal timestamp');
  if (!HASH32_RE.test(publicInputs.criteria_root)) errors.push('criteria_root must be a 0x-prefixed 32-byte hash');
  return errors;
}
