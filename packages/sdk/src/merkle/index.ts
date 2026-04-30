import { sha256 } from '@noble/hashes/sha2.js';
import { PublicKey } from '@solana/web3.js';

function hash(a: Uint8Array, b: Uint8Array): Uint8Array {
  return compare(a, b) <= 0
    ? sha256(concat(a, b))
    : sha256(concat(b, a));
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

function concat(...bufs: Uint8Array[]): Uint8Array {
  const len = bufs.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const b of bufs) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

function u64Le(v: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, v, true);
  return buf;
}

function u128Le(v: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, v & 0xffffffffffffffffn, true);
  view.setBigUint64(8, v >> 64n, true);
  return buf;
}

export class MerkleTree {
  readonly layers: Uint8Array[][];

  constructor(leaves: Uint8Array[]) {
    if (leaves.length === 0) {
      this.layers = [[new Uint8Array(32)]];
      return;
    }
    let layer = leaves.map((l) => Uint8Array.from(l));
    this.layers = [layer];
    while (layer.length > 1) {
      const next: Uint8Array[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        if (i + 1 < layer.length) {
          next.push(hash(layer[i]!, layer[i + 1]!));
        } else {
          next.push(layer[i]!);
        }
      }
      layer = next;
      this.layers.push(layer);
    }
  }

  get root(): Uint8Array {
    return this.layers[this.layers.length - 1]![0]!;
  }

  getProof(index: number): Uint8Array[] {
    const proof: Uint8Array[] = [];
    let idx = index;
    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i]!;
      const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (sibling < layer.length) {
        proof.push(layer[sibling]!);
      }
      idx = Math.floor(idx / 2);
    }
    return proof;
  }

  static verify(root: Uint8Array, leaf: Uint8Array, proof: Uint8Array[]): boolean {
    let computed = Uint8Array.from(leaf);
    for (const node of proof) {
      computed = hash(computed, node);
    }
    return compare(computed, root) === 0;
  }
}

export function governanceLeaf(voter: PublicKey, weight: bigint): Uint8Array {
  return sha256(concat(voter.toBytes(), u128Le(weight)));
}

export function feeClaimLeaf(staker: PublicKey, amount: bigint, epochId: bigint): Uint8Array {
  return sha256(concat(staker.toBytes(), u64Le(amount), u64Le(epochId)));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}
