// Slot/timestamp warping helper.
//
// Long-term: replace with `solana-bankrun` so we can jump the clock without
// sleeping. For now we provide a `sleep()` shim — suitable for localnet but
// painfully slow for 7-day / 30-day timelocks. Those tests are marked pending
// and will be migrated to bankrun when the harness gets upgraded.

// CU-MEASURE-PENDING: bankrun adapter not yet wired.

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
