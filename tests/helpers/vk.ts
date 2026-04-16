import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ProofVerifier } from '../../target/types/proof_verifier';

export const DEFAULT_CIRCUIT_LABEL = 'task_completion_v1';

export function fieldElementToBytes(decimal: string): Buffer {
  let n = BigInt(decimal);
  const buf = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

export function g1ToBytes(point: [string, string, string]): number[] {
  return [...fieldElementToBytes(point[0]), ...fieldElementToBytes(point[1])];
}

export function g2ToBytes(
  point: [[string, string], [string, string], [string, string]],
): number[] {
  const x_im = fieldElementToBytes(point[0][1]);
  const x_re = fieldElementToBytes(point[0][0]);
  const y_im = fieldElementToBytes(point[1][1]);
  const y_re = fieldElementToBytes(point[1][0]);
  return [...x_im, ...x_re, ...y_im, ...y_re];
}

export function computeVkId(label: string): Buffer {
  return createHash('sha256').update(label).digest();
}

export function padLabel(s: string, len = 32): number[] {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

export function loadDevVk() {
  const vkPath = resolve(__dirname, '../../circuits/task_completion/build/verification_key.json');
  return JSON.parse(readFileSync(vkPath, 'utf-8'));
}

export async function registerDevVk(
  program: anchor.Program<ProofVerifier>,
  authority: anchor.web3.PublicKey,
  vkId: Buffer,
  label: string = DEFAULT_CIRCUIT_LABEL,
) {
  const vkJson = loadDevVk();
  const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
  const betaG2 = g2ToBytes(vkJson.vk_beta_2);
  const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
  const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
  const ic = vkJson.IC.map((p: [string, string, string]) => g1ToBytes(p));

  await program.methods
    .registerVk(
      Array.from(vkId) as unknown as number[],
      alphaG1 as unknown as number[],
      betaG2 as unknown as number[],
      gammaG2 as unknown as number[],
      deltaG2 as unknown as number[],
      ic as unknown as number[][],
      vkJson.nPublic,
      padLabel(label) as unknown as number[],
      false,
    )
    .accountsPartial({ authority, payer: authority })
    .rpc();
}
