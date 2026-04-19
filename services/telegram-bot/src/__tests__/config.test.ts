import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

describe('config', () => {
  it('requires TELEGRAM_BOT_TOKEN', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('parses valid env with defaults', () => {
    const cfg = loadConfig({ TELEGRAM_BOT_TOKEN: 'test:token' });
    expect(cfg.botToken).toBe('test:token');
    expect(cfg.rpcUrl).toContain('devnet');
    expect(cfg.cluster).toBe('devnet');
    expect(cfg.portalUrl).toBe('https://buildonsaep.com');
    expect(cfg.port).toBe(3100);
  });

  it('accepts override values', () => {
    const cfg = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test:token',
      SOLANA_RPC_URL: 'https://custom.rpc',
      SAEP_CLUSTER: 'mainnet-beta',
      PORTAL_URL: 'https://custom.portal',
      PORT: '4000',
    });
    expect(cfg.rpcUrl).toBe('https://custom.rpc');
    expect(cfg.cluster).toBe('mainnet-beta');
    expect(cfg.portalUrl).toBe('https://custom.portal');
    expect(cfg.port).toBe(4000);
  });
});
