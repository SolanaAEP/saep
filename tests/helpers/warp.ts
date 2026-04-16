// Localnet wall-clock warping helpers. For clock jumps > 30s (timelock
// coverage) use `warpClockBy` from `./bankrun.ts` instead.

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function warpSeconds(seconds: number): Promise<void> {
  // Localnet wall-clock only. If `seconds` is large, the caller is expected
  // to skip or move to bankrun.
  if (seconds > 30) {
    throw new Error(
      `warpSeconds(${seconds}) exceeds 30s. Use bankrun adapter for long timelocks.`,
    );
  }
  await sleep(seconds * 1000);
}

export async function warpToSlot(_targetSlot: number): Promise<void> {
  throw new Error('warpToSlot requires bankrun adapter. Not implemented in M1 harness.');
}
