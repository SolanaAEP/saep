import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('produces sane defaults with no env set', () => {
    const cfg = loadConfig({});
    expect(cfg.mode).toBe('observe');
    expect(cfg.cluster).toBe('mainnet-beta');
    expect(cfg.saepMint).toBe('HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump');
    expect(cfg.usdcMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(cfg.taskMarketProgramId).toBe('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w');
    expect(cfg.feeCollectorProgramId).toBe('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu');
    expect(cfg.pollIntervalMs).toBe(3_600_000);
    expect(cfg.swapThresholdUsdc).toBe(50_000_000);
    expect(cfg.slippageBps).toBe(200);
  });

  it('reads env overrides', () => {
    const cfg = loadConfig({
      BUYBACK_MODE: 'active',
      BUYBACK_POLL_INTERVAL_MS: '600000',
      BUYBACK_SWAP_THRESHOLD_USDC_BASE: '100000000',
      BUYBACK_SLIPPAGE_BPS: '50',
      SAEP_CLUSTER: 'devnet',
    });
    expect(cfg.mode).toBe('active');
    expect(cfg.pollIntervalMs).toBe(600_000);
    expect(cfg.swapThresholdUsdc).toBe(100_000_000);
    expect(cfg.slippageBps).toBe(50);
    expect(cfg.cluster).toBe('devnet');
  });

  it('rejects out-of-range slippage', () => {
    expect(() => loadConfig({ BUYBACK_SLIPPAGE_BPS: '1500' })).toThrow();
    expect(() => loadConfig({ BUYBACK_SLIPPAGE_BPS: '0' })).toThrow();
  });

  it('rejects sub-minute poll intervals', () => {
    expect(() => loadConfig({ BUYBACK_POLL_INTERVAL_MS: '5000' })).toThrow();
  });

  it('rejects invalid mode strings', () => {
    expect(() => loadConfig({ BUYBACK_MODE: 'paranoid' })).toThrow();
  });
});
