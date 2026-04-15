export type CctpMessage = {
  sourceDomain: number;
  destDomain: number;
  amount: bigint;
  recipient: string;
  nonce: string;
};

export const SOLANA_DOMAIN = 5;

export type AttestationPoller = (
  messageHash: string,
) => Promise<{ attestation: string } | null>;

export async function waitForAttestation(
  messageHash: string,
  poll: AttestationPoller,
  timeoutMs: number,
  intervalMs = 2_000,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const res = await poll(messageHash);
    if (res) return res.attestation;
    if (now() >= deadline) {
      throw new Error(`cctp attestation timeout after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}

export function validateCctpTarget(msg: CctpMessage): void {
  if (msg.destDomain !== SOLANA_DOMAIN) {
    throw new Error(`cctp dest domain must be solana (${SOLANA_DOMAIN})`);
  }
  if (msg.amount <= 0n) {
    throw new Error('cctp amount must be positive');
  }
}
