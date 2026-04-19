import { describe, it, expect } from 'vitest';
import { formatSiwsMessage, type SiwsMessage } from '../siws.js';

const baseMsg: SiwsMessage = {
  domain: 'buildonsaep.com',
  address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  statement: 'Sign in to SAEP portal.',
  uri: 'https://buildonsaep.com',
  version: '1',
  chainId: 'devnet',
  nonce: 'abc123',
  issuedAt: '2026-01-01T00:00:00.000Z',
  expirationTime: '2026-01-01T00:05:00.000Z',
};

describe('formatSiwsMessage', () => {
  it('produces header with domain + address', () => {
    const out = formatSiwsMessage(baseMsg);
    expect(out).toContain('buildonsaep.com wants you to sign in with your Solana account:');
    expect(out).toContain(baseMsg.address);
  });

  it('includes statement', () => {
    const out = formatSiwsMessage(baseMsg);
    expect(out).toContain('Sign in to SAEP portal.');
  });

  it('includes all SIWS fields with labels', () => {
    const out = formatSiwsMessage(baseMsg);
    expect(out).toContain('URI: https://buildonsaep.com');
    expect(out).toContain('Version: 1');
    expect(out).toContain('Chain ID: devnet');
    expect(out).toContain('Nonce: abc123');
    expect(out).toContain('Issued At: 2026-01-01T00:00:00.000Z');
    expect(out).toContain('Expiration Time: 2026-01-01T00:05:00.000Z');
  });

  it('separates header, statement, and fields with blank lines', () => {
    const out = formatSiwsMessage(baseMsg);
    const parts = out.split('\n\n');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/wants you to sign in/);
    expect(parts[1]).toBe('Sign in to SAEP portal.');
    expect(parts[2]).toMatch(/^URI:/);
  });

  it('is deterministic', () => {
    expect(formatSiwsMessage(baseMsg)).toBe(formatSiwsMessage(baseMsg));
  });

  it('varies with different nonce', () => {
    const altered = { ...baseMsg, nonce: 'xyz789' };
    expect(formatSiwsMessage(altered)).not.toBe(formatSiwsMessage(baseMsg));
    expect(formatSiwsMessage(altered)).toContain('Nonce: xyz789');
  });

  it('varies with different domain', () => {
    const altered = { ...baseMsg, domain: 'localhost:3000' };
    const out = formatSiwsMessage(altered);
    expect(out).toContain('localhost:3000 wants you to sign in');
  });
});
