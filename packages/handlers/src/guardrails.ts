export interface GuardrailOpts {
  maxAutoSignLamports?: number;
  velocityLimit?: number;
}

const DEFAULT_MAX_LAMPORTS = 1_000_000;
const DEFAULT_VELOCITY_LIMIT = 10;

const autoSignTimestamps: number[] = [];

function checkVelocity(limit: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  while (autoSignTimestamps.length > 0 && autoSignTimestamps[0]! < windowStart) {
    autoSignTimestamps.shift();
  }
  return autoSignTimestamps.length < limit;
}

function recordAutoSign(): void {
  autoSignTimestamps.push(Date.now());
}

export function enforceGuardrails(opts: GuardrailOpts | undefined, valueLamports?: number): void {
  const maxLamports = opts?.maxAutoSignLamports ?? DEFAULT_MAX_LAMPORTS;
  const velocityLimit = opts?.velocityLimit ?? DEFAULT_VELOCITY_LIMIT;
  if (valueLamports !== undefined && valueLamports > maxLamports) {
    throw new Error(
      `Auto-sign rejected: transaction value ${valueLamports} lamports exceeds cap ${maxLamports}. ` +
        `Ask the human to sign manually or increase maxAutoSignLamports.`,
    );
  }
  if (!checkVelocity(velocityLimit)) {
    throw new Error(
      `Auto-sign rejected: velocity limit exceeded (${velocityLimit} transactions per 60s window). ` +
        `Wait before submitting more transactions or ask the human to sign manually.`,
    );
  }
  recordAutoSign();
}

export function resetVelocityWindow(): void {
  autoSignTimestamps.length = 0;
}
