import { createHash } from 'node:crypto';
import { wormholeVaas } from './metrics.js';

// wormhole chain IDs
export const CHAIN_ID_ETH = 2;
export const CHAIN_ID_SOLANA = 1;
export const CHAIN_ID_BSC = 4;

const GUARDIAN_SET_EXPIRY_MS = 86400 * 1000;
const MIN_GUARDIAN_SIGNATURES = 13; // 2/3+1 of 19 mainnet guardians

export interface VaaPayload {
  version: number;
  guardianSetIndex: number;
  signatures: VaaSignature[];
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: Uint8Array;
  sequence: bigint;
  consistencyLevel: number;
  payload: Uint8Array;
}

export interface VaaSignature {
  guardianIndex: number;
  r: Uint8Array;
  s: Uint8Array;
  v: number;
}

export interface BridgeTransfer {
  sourceChain: number;
  tokenAddress: Uint8Array;
  amount: bigint;
  recipientChain: number;
  recipient: Uint8Array;
  fee: bigint;
}

// known token addresses (wormhole-wrapped)
const KNOWN_TOKENS: Record<string, string> = {
  // ETH on wormhole (chain 2)
  '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  // USDC on wormhole (chain 2)
  '000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
};

export function parseVaa(bytes: Uint8Array): VaaPayload {
  if (bytes.length < 6) throw new Error('VAA too short');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const version = view.getUint8(offset); offset += 1;
  if (version !== 1) throw new Error(`unsupported VAA version: ${version}`);

  const guardianSetIndex = view.getUint32(offset); offset += 4;
  const sigCount = view.getUint8(offset); offset += 1;

  const signatures: VaaSignature[] = [];
  for (let i = 0; i < sigCount; i++) {
    const guardianIndex = view.getUint8(offset); offset += 1;
    const r = bytes.slice(offset, offset + 32); offset += 32;
    const s = bytes.slice(offset, offset + 32); offset += 32;
    const v = view.getUint8(offset); offset += 1;
    signatures.push({ guardianIndex, r, s, v });
  }

  const bodyOffset = offset;
  const timestamp = view.getUint32(offset); offset += 4;
  const nonce = view.getUint32(offset); offset += 4;
  const emitterChain = view.getUint16(offset); offset += 2;
  const emitterAddress = bytes.slice(offset, offset + 32); offset += 32;
  const sequence = view.getBigUint64(offset); offset += 8;
  const consistencyLevel = view.getUint8(offset); offset += 1;
  const payload = bytes.slice(offset);

  return {
    version,
    guardianSetIndex,
    signatures,
    timestamp,
    nonce,
    emitterChain,
    emitterAddress,
    sequence,
    consistencyLevel,
    payload,
  };
}

export function parseTransferPayload(payload: Uint8Array): BridgeTransfer {
  if (payload.length < 133) throw new Error('transfer payload too short');

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let offset = 0;

  const payloadType = view.getUint8(offset); offset += 1;
  if (payloadType !== 1 && payloadType !== 3) {
    throw new Error(`unexpected payload type: ${payloadType} (expected 1=transfer or 3=transferWithPayload)`);
  }

  const amount = view.getBigUint64(offset + 24); offset += 32;
  const tokenAddress = payload.slice(offset, offset + 32); offset += 32;
  const tokenChain = view.getUint16(offset); offset += 2;
  const recipient = payload.slice(offset, offset + 32); offset += 32;
  const recipientChain = view.getUint16(offset); offset += 2;
  const fee = view.getBigUint64(offset + 24);

  return {
    sourceChain: tokenChain,
    tokenAddress,
    amount,
    recipientChain,
    recipient,
    fee,
  };
}

export function verifyVaa(vaa: VaaPayload): { valid: boolean; reason?: string } {
  if (vaa.signatures.length < MIN_GUARDIAN_SIGNATURES) {
    wormholeVaas.inc({ status: 'insufficient_sigs' });
    return { valid: false, reason: `need ${MIN_GUARDIAN_SIGNATURES} sigs, got ${vaa.signatures.length}` };
  }

  const seen = new Set<number>();
  for (const sig of vaa.signatures) {
    if (seen.has(sig.guardianIndex)) {
      wormholeVaas.inc({ status: 'duplicate_guardian' });
      return { valid: false, reason: `duplicate guardian index ${sig.guardianIndex}` };
    }
    seen.add(sig.guardianIndex);
  }

  const ageMs = Date.now() - vaa.timestamp * 1000;
  if (ageMs > GUARDIAN_SET_EXPIRY_MS) {
    wormholeVaas.inc({ status: 'expired' });
    return { valid: false, reason: 'VAA expired' };
  }

  if (ageMs < -300_000) {
    wormholeVaas.inc({ status: 'future' });
    return { valid: false, reason: 'VAA timestamp in future' };
  }

  wormholeVaas.inc({ status: 'valid' });
  return { valid: true };
}

export function vaaDigest(vaa: VaaPayload): Buffer {
  const h = createHash('sha256');
  const buf = Buffer.alloc(51 + vaa.payload.length);
  let offset = 0;
  buf.writeUInt32BE(vaa.timestamp, offset); offset += 4;
  buf.writeUInt32BE(vaa.nonce, offset); offset += 4;
  buf.writeUInt16BE(vaa.emitterChain, offset); offset += 2;
  Buffer.from(vaa.emitterAddress).copy(buf, offset); offset += 32;
  buf.writeBigUInt64BE(vaa.sequence, offset); offset += 8;
  buf.writeUInt8(vaa.consistencyLevel, offset); offset += 1;
  Buffer.from(vaa.payload).copy(buf, offset);
  h.update(buf);
  return createHash('sha256').update(h.digest()).digest();
}

export function identifyToken(tokenAddress: Uint8Array): string | null {
  const hex = Buffer.from(tokenAddress).toString('hex');
  return KNOWN_TOKENS[hex] ?? null;
}
