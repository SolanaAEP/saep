import type { SerializedTemplateRental } from './template-serializer';

export function bytesFromHex(hex: string, label: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }
  return Uint8Array.from(normalized.match(/.{2}/g)!.map((part) => parseInt(part, 16)));
}

export function rentalPrepaidAmount(
  rentPricePerSec: string | bigint,
  durationSecs: number | bigint,
): bigint {
  const rate = typeof rentPricePerSec === 'bigint' ? rentPricePerSec : BigInt(rentPricePerSec || '0');
  const duration = typeof durationSecs === 'bigint' ? durationSecs : BigInt(Math.max(0, Math.floor(durationSecs)));
  return rate * duration;
}

export function formatBaseUnits(
  value: bigint | string,
  decimals = 6,
  symbol = 'units',
): string {
  const raw = typeof value === 'bigint' ? value : BigInt(value || '0');
  const sign = raw < 0n ? '-' : '';
  const abs = raw < 0n ? -raw : raw;
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = abs / scale;
  const fraction = abs % scale;
  const trimmed = fraction
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')
    .slice(0, 4);
  return `${sign}${whole.toLocaleString()}${trimmed ? `.${trimmed}` : ''} ${symbol}`;
}

export function rentalRemainingSeconds(
  rental: Pick<SerializedTemplateRental, 'endTime' | 'status'>,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  if (rental.status !== 'active') return 0;
  return Math.max(0, rental.endTime - nowSec);
}

export function rentalAccruedAmount(
  rental: Pick<SerializedTemplateRental, 'startTime' | 'endTime' | 'dripRatePerSec'>,
  nowSec = Math.floor(Date.now() / 1000),
): bigint {
  const effectiveEnd = Math.min(nowSec, rental.endTime);
  const elapsed = Math.max(0, effectiveEnd - rental.startTime);
  return BigInt(rental.dripRatePerSec || '0') * BigInt(elapsed);
}

export function rentalClaimableAmount(
  rental: Pick<
    SerializedTemplateRental,
    'startTime' | 'endTime' | 'dripRatePerSec' | 'claimedAuthor' | 'claimedPlatform'
  >,
  nowSec = Math.floor(Date.now() / 1000),
): bigint {
  const accrued = rentalAccruedAmount(rental, nowSec);
  const claimed = BigInt(rental.claimedAuthor || '0') + BigInt(rental.claimedPlatform || '0');
  return accrued > claimed ? accrued - claimed : 0n;
}

export function formatDurationShort(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}
