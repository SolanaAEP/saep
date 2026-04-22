export type VerificationKeyType = 'groth16-bn254' | 'ezkl';

export type CircuitLifecycle = 'live' | 'planned' | 'research';

export interface CircuitCatalogEntry {
  slug: string;
  displayName: string;
  lifecycle: CircuitLifecycle;
  version: number;
  verifier: VerificationKeyType;
  verificationKeyVersion: number;
  publicInputs: readonly string[];
  summary: string;
}

export const DEFAULT_CIRCUIT_CATALOG: readonly CircuitCatalogEntry[] = [
  {
    slug: 'task-completion',
    displayName: 'Task Completion',
    lifecycle: 'live',
    version: 1,
    verifier: 'groth16-bn254',
    verificationKeyVersion: 1,
    publicInputs: ['task_hash', 'result_hash', 'deadline', 'submitted_at', 'criteria_root'],
    summary:
      'Current task-completion proof used to bind escrow release to a committed task/result pair.',
  },
  {
    slug: 'unique-execution',
    displayName: 'Unique Execution',
    lifecycle: 'live',
    version: 1,
    verifier: 'groth16-bn254',
    verificationKeyVersion: 1,
    publicInputs: ['execution_root', 'task_id', 'nonce'],
    summary:
      'Reusable anti-replay and unique-execution primitive for proof-gated work classes.',
  },
  {
    slug: 'task-output-hash',
    displayName: 'Deterministic Task Output Hashing',
    lifecycle: 'planned',
    version: 1,
    verifier: 'groth16-bn254',
    verificationKeyVersion: 1,
    publicInputs: ['task_id', 'input_hash', 'output_hash'],
    summary:
      'First reusable helper circuit for binding task inputs and outputs without re-specifying hash order per task family.',
  },
  {
    slug: 'zkml-ezkl',
    displayName: 'ZK-ML via EZKL',
    lifecycle: 'research',
    version: 1,
    verifier: 'ezkl',
    verificationKeyVersion: 1,
    publicInputs: ['task_id', 'model_hash', 'input_hash', 'output_hash'],
    summary:
      'Research track for verifiable inference proofs once Solana-side verification feasibility is proven.',
  },
] as const;

export function circuitArtifactStem(entry: Pick<CircuitCatalogEntry, 'slug' | 'version'>): string {
  return `${entry.slug}-v${entry.version}`;
}

export function circuitManifestPath(entry: Pick<CircuitCatalogEntry, 'slug' | 'version'>): string {
  return `circuits/catalog/${circuitArtifactStem(entry)}.json`;
}

export function circuitRuntimeId(entry: Pick<CircuitCatalogEntry, 'slug' | 'version'>): string {
  return `${entry.slug.replace(/-/g, '_')}.v${entry.version}`;
}

export function circuitRuntimeStem(entry: Pick<CircuitCatalogEntry, 'slug'>): string {
  return entry.slug.replace(/-/g, '_');
}

export function validateCircuitCatalogEntry(entry: CircuitCatalogEntry): string[] {
  const errors: string[] = [];
  if (entry.version < 1) errors.push('version must be >= 1');
  if (entry.verificationKeyVersion < 1) errors.push('verificationKeyVersion must be >= 1');
  if (entry.publicInputs.length === 0) errors.push('publicInputs must not be empty');
  if (new Set(entry.publicInputs).size !== entry.publicInputs.length) {
    errors.push('publicInputs must be unique');
  }
  if (!/^[a-z0-9-]+$/.test(entry.slug)) {
    errors.push('slug must contain only lowercase letters, numbers, and dashes');
  }
  return errors;
}
