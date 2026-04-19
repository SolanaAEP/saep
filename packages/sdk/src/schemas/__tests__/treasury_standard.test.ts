import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  AgentTreasurySchema,
  AllowedMintsSchema,
  InitStreamArgsSchema,
  InitTreasuryArgsSchema,
  PaymentStreamSchema,
  StreamStatusSchema,
  TreasuryGlobalSchema,
  WithdrawArgsSchema,
  WithdrawEarnedArgsSchema,
} from '../treasury_standard.js';

const pk = () => PublicKey.default;
const bytes = (n: number) => Array.from({ length: n }, (_, i) => i % 256);

describe('StreamStatusSchema', () => {
  it.each(['active', 'closed'])('accepts %s', (s) => {
    expect(StreamStatusSchema.parse(s)).toBe(s);
  });

  it('rejects unknown status', () => {
    expect(() => StreamStatusSchema.parse('paused')).toThrow();
  });
});

describe('TreasuryGlobalSchema', () => {
  const valid = {
    authority: pk(),
    pendingAuthority: null,
    agentRegistry: pk(),
    jupiterProgram: pk(),
    allowedMints: pk(),
    maxStreamDuration: new BN(2_592_000),
    defaultDailyLimit: new BN(1_000_000),
    maxDailyLimit: new BN(10_000_000),
    paused: false,
    bump: 254,
  };

  it('parses well-formed global', () => {
    expect(TreasuryGlobalSchema.parse(valid)).toEqual(valid);
  });

  it('rejects non-BN limits', () => {
    expect(() => TreasuryGlobalSchema.parse({ ...valid, maxDailyLimit: 1 })).toThrow();
  });
});

describe('AgentTreasurySchema', () => {
  const valid = {
    agentDid: bytes(32),
    operator: pk(),
    dailySpendLimit: new BN(1_000_000),
    perTxLimit: new BN(100_000),
    weeklyLimit: new BN(7_000_000),
    spentToday: new BN(0),
    spentThisWeek: new BN(0),
    lastResetDay: new BN(0),
    lastResetWeek: new BN(0),
    streamingActive: false,
    streamCounterparty: null,
    streamRatePerSec: new BN(0),
    bump: 254,
  };

  it('parses well-formed treasury', () => {
    expect(AgentTreasurySchema.parse(valid)).toEqual(valid);
  });

  it('accepts a non-null streamCounterparty', () => {
    expect(() =>
      AgentTreasurySchema.parse({ ...valid, streamCounterparty: pk(), streamingActive: true }),
    ).not.toThrow();
  });

  it('rejects agentDid of wrong length', () => {
    expect(() => AgentTreasurySchema.parse({ ...valid, agentDid: bytes(31) })).toThrow();
  });
});

describe('AllowedMintsSchema', () => {
  it('parses an empty mint list', () => {
    expect(AllowedMintsSchema.parse({ authority: pk(), mints: [], bump: 254 }).mints).toEqual([]);
  });

  it('parses with multiple mints', () => {
    const mints = [pk(), pk(), pk()];
    expect(AllowedMintsSchema.parse({ authority: pk(), mints, bump: 254 }).mints).toHaveLength(3);
  });

  it('rejects non-array mints', () => {
    expect(() => AllowedMintsSchema.parse({ authority: pk(), mints: pk(), bump: 254 })).toThrow();
  });
});

describe('PaymentStreamSchema', () => {
  const valid = {
    agentDid: bytes(32),
    client: pk(),
    payerMint: pk(),
    payoutMint: pk(),
    ratePerSec: new BN(100),
    startTime: new BN(1700000000),
    maxDuration: new BN(86_400),
    depositTotal: new BN(8_640_000),
    withdrawn: new BN(0),
    escrowBump: 253,
    status: { active: {} },
    streamNonce: bytes(8),
    bump: 254,
  };

  it('parses well-formed stream', () => {
    expect(PaymentStreamSchema.parse(valid)).toEqual(valid);
  });

  it('rejects streamNonce of wrong length', () => {
    expect(() => PaymentStreamSchema.parse({ ...valid, streamNonce: bytes(7) })).toThrow();
  });
});

describe('arg schemas', () => {
  it('InitTreasuryArgsSchema parses', () => {
    const out = InitTreasuryArgsSchema.parse({
      agentDid: bytes(32),
      dailySpendLimit: new BN(100),
      perTxLimit: new BN(10),
      weeklyLimit: new BN(700),
    });
    expect(out.agentDid).toHaveLength(32);
  });

  it('WithdrawArgsSchema rejects non-BN amount', () => {
    expect(() => WithdrawArgsSchema.parse({ amount: 1 })).toThrow();
  });

  it('InitStreamArgsSchema parses', () => {
    expect(
      InitStreamArgsSchema.parse({
        streamNonce: bytes(8),
        ratePerSec: new BN(1),
        maxDuration: new BN(60),
      }).streamNonce,
    ).toHaveLength(8);
  });

  it('WithdrawEarnedArgsSchema parses Uint8Array routeData', () => {
    const out = WithdrawEarnedArgsSchema.parse({ routeData: new Uint8Array([1, 2, 3]) });
    expect(out.routeData).toBeInstanceOf(Uint8Array);
    expect(out.routeData.length).toBe(3);
  });

  it('WithdrawEarnedArgsSchema rejects plain array routeData', () => {
    expect(() => WithdrawEarnedArgsSchema.parse({ routeData: [1, 2, 3] })).toThrow();
  });
});
