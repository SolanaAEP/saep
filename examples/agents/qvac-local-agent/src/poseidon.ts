// Wraps circomlibjs's Poseidon hash so we can build the same task_completion
// circuit witness shape that scripts/gen_sample.mjs produces. The agent calls
// these to chain on-chain task_hash, the LLM-output result_hash, and the
// criteria Merkle root used as the circuit's public inputs.

// @ts-expect-error — circomlibjs ships no types
import { buildPoseidon } from 'circomlibjs';

export const TASK_TAG = BigInt(0x5441534b); // "TASK"
export const RESULT_TAG = BigInt(0x52534c54); // "RSLT"

type PoseidonField = {
  toObject(value: unknown): bigint;
};

type PoseidonHash = ((inputs: bigint[]) => unknown) & { F: PoseidonField };

let cached: PoseidonHash | null = null;

export async function poseidon(): Promise<PoseidonHash> {
  if (cached) return cached;
  cached = (await buildPoseidon()) as PoseidonHash;
  return cached;
}

export async function poseidonOne(input: bigint): Promise<bigint> {
  const p = await poseidon();
  return p.F.toObject(p([input]));
}

export async function poseidonPair(a: bigint, b: bigint): Promise<bigint> {
  const p = await poseidon();
  return p.F.toObject(p([a, b]));
}

// Sponge construction matching scripts/gen_sample.mjs: feed inputs in chunks
// of 15 plus a running tag-prefixed state. The resulting field element is the
// circuit's expected hash for both task_preimage (with tag = TASK_TAG) and
// result_preimage (with tag = RESULT_TAG).
export async function poseidonSponge(
  tag: bigint,
  inputs: bigint[],
  chunkSize = 15,
): Promise<bigint> {
  const p = await poseidon();
  const nChunks = Math.max(1, Math.ceil(inputs.length / chunkSize));
  const padded = inputs.slice();
  while (padded.length < nChunks * chunkSize) padded.push(0n);

  let state = tag;
  for (let c = 0; c < nChunks; c += 1) {
    const chunk = padded.slice(c * chunkSize, (c + 1) * chunkSize);
    state = p.F.toObject(p([state, ...chunk]));
  }
  return state;
}

// Hash an arbitrary text field element list (e.g. brief or LLM output) into
// the chunked field-element format the circuit expects.
export function textToFieldElements(text: string, chunks: number): bigint[] {
  const bytes = new TextEncoder().encode(text);
  const out: bigint[] = [];
  // Each field element packs ~31 bytes safely (bn254 scalar field is 254 bits).
  const bytesPerField = 31;
  const total = chunks * bytesPerField;
  const padded = new Uint8Array(total);
  padded.set(bytes.slice(0, total));
  for (let i = 0; i < chunks; i += 1) {
    let value = 0n;
    for (let b = 0; b < bytesPerField; b += 1) {
      value = (value << 8n) | BigInt(padded[i * bytesPerField + b]!);
    }
    out.push(value);
  }
  return out;
}

// Build a Merkle root + path/index for leaf 0 over a depth-3 tree of K=8
// criteria bits. Mirrors the layout in scripts/gen_sample.mjs so the circuit
// constraint MerkleVerify(criteria_satisfied, criteria_path, criteria_index)
// passes.
export async function criteriaMerkleProof(
  satisfied: bigint[],
): Promise<{ root: bigint; path: bigint[]; index: bigint[] }> {
  if (satisfied.length !== 8) throw new Error('criteria must be 8 bits');
  const p = await poseidon();
  const leaves = await Promise.all(
    satisfied.map(async (leaf) => poseidonOne(leaf)),
  );

  const l1 = [
    p.F.toObject(p([leaves[0]!, leaves[1]!])),
    p.F.toObject(p([leaves[2]!, leaves[3]!])),
    p.F.toObject(p([leaves[4]!, leaves[5]!])),
    p.F.toObject(p([leaves[6]!, leaves[7]!])),
  ];
  const l2 = [
    p.F.toObject(p([l1[0]!, l1[1]!])),
    p.F.toObject(p([l1[2]!, l1[3]!])),
  ];
  const root = p.F.toObject(p([l2[0]!, l2[1]!]));

  // Leaf index 0 sits at the leftmost slot; siblings are right children.
  const path = [leaves[1]!, l1[1]!, l2[1]!];
  const index = [0n, 0n, 0n];
  return { root, path, index };
}
