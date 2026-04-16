import { PublicKey } from '@solana/web3.js';

const TIP_FLOOR_LAMPORTS = 1_000;
const TIP_HEADROOM = 1.2;
const TIP_CAP_BPS = 100; // 1% of task payment

export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bPuAqfr4XCBQNGLDn7PkJE',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSLGSMBSVGaDBS9kmMP',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL6d33',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
].map((s) => new PublicKey(s));

export function pickTipAccount(): PublicKey {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]!;
}

export function computeTip(opts: {
  recentTipLamports?: number;
  taskPaymentLamports?: bigint;
}): number {
  const base = opts.recentTipLamports
    ? Math.ceil(opts.recentTipLamports * TIP_HEADROOM)
    : TIP_FLOOR_LAMPORTS;

  const tip = Math.max(base, TIP_FLOOR_LAMPORTS);

  if (opts.taskPaymentLamports != null) {
    const cap = Number(opts.taskPaymentLamports) * TIP_CAP_BPS / 10_000;
    return Math.min(tip, Math.max(Math.floor(cap), TIP_FLOOR_LAMPORTS));
  }

  return tip;
}
