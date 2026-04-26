import { MAINNET_SAEP_MINT, MAINNET_USDC_MINT } from '@/lib/mainnet-status';

export const KNOWN_PAYMENT_MINTS: Record<string, { symbol: string; decimals: number }> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
  [MAINNET_USDC_MINT]: { symbol: 'USDC', decimals: 6 },
  [MAINNET_SAEP_MINT]: { symbol: 'SAEP', decimals: 6 },
};

export function mintLabel(address: string): string {
  const known = KNOWN_PAYMENT_MINTS[address];
  if (known) return `${known.symbol} (${address.slice(0, 4)}...${address.slice(-4)})`;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function mintSymbol(address: string): string {
  return KNOWN_PAYMENT_MINTS[address]?.symbol ?? 'tokens';
}

export function guessDecimals(address: string): number {
  return KNOWN_PAYMENT_MINTS[address]?.decimals ?? 6;
}

export function suggestedTinyAmount(address: string): string {
  if (address === MAINNET_SAEP_MINT) return '100';
  if (address === MAINNET_USDC_MINT) return '1';
  return '1';
}

export function preferredPaymentMint(mints: Array<{ toBase58(): string }>): string | undefined {
  const addresses = mints.map((mint) => mint.toBase58());
  return (
    addresses.find((address) => address === MAINNET_USDC_MINT) ??
    addresses.find((address) => address === MAINNET_SAEP_MINT) ??
    addresses[0]
  );
}

export function toBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!trimmed) return 0n;
  const normalized = trimmed.replace(/_/g, '');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Payment amount must be a positive number');
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Payment amount supports at most ${decimals} decimals`);
  }
  const paddedFraction = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(`${whole}${paddedFraction}`);
}

export function formatBaseUnits(
  amount: bigint | string,
  decimals: number,
  symbol?: string,
  fractionDigits = decimals === 9 ? 4 : 2,
): string {
  const raw = typeof amount === 'bigint' ? amount.toString() : amount;
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '') || '0';
  const safeFractionDigits = Math.max(0, Math.min(fractionDigits, decimals));

  if (decimals === 0) {
    return `${negative ? '-' : ''}${digits}${symbol ? ` ${symbol}` : ''}`;
  }

  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals, -decimals + safeFractionDigits).padEnd(
    safeFractionDigits,
    '0',
  );

  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}${
    symbol ? ` ${symbol}` : ''
  }`;
}

export function formatPaymentAmount(
  amount: bigint | string | null | undefined,
  mint?: string | null,
): string {
  if (amount == null) return '—';
  const decimals = mint ? guessDecimals(mint) : 6;
  const symbol = mint ? mintSymbol(mint) : 'tokens';
  return formatBaseUnits(amount, decimals, symbol);
}
