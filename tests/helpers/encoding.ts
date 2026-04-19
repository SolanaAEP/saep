import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const jsSha3 = _require('js-sha3');

export function padBytes(s: string, len: number): number[] {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

export function computeCommitHash(
  amount: bigint,
  nonce: Uint8Array,
  agentDid: Uint8Array,
): number[] {
  const amountLe = new Uint8Array(8);
  new DataView(amountLe.buffer).setBigUint64(0, amount, true);
  const buf = Buffer.concat([
    Buffer.from(amountLe),
    Buffer.from(nonce),
    Buffer.from(agentDid),
  ]);
  const hash = jsSha3.keccak_256.arrayBuffer(buf);
  return Array.from(new Uint8Array(hash));
}
