import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  AgentAccountSchema,
  AgentStatusSchema,
  JobOutcomeSchema,
  PendingSlashSchema,
  PendingWithdrawalSchema,
  RegisterAgentArgsSchema,
  RegistryGlobalSchema,
  ReputationScoreSchema,
  StakeIncreaseArgsSchema,
  StakeWithdrawRequestArgsSchema,
  UpdateManifestArgsSchema,
} from '../agent_registry.js';

const pk = () => PublicKey.default;
const bytes = (n: number) => Array.from({ length: n }, (_, i) => i % 256);

const reputation = {
  quality: 9000,
  timeliness: 8500,
  availability: 9500,
  costEfficiency: 8000,
  honesty: 9800,
  volume: 4200,
  ewmaAlphaBps: 1000,
  sampleCount: 42,
  lastUpdate: new BN(1700000000),
  _reserved: bytes(24),
};

describe('ReputationScoreSchema', () => {
  it('parses well-formed scores', () => {
    expect(ReputationScoreSchema.parse(reputation)).toEqual(reputation);
  });

  it('rejects _reserved with wrong length', () => {
    expect(() =>
      ReputationScoreSchema.parse({ ...reputation, _reserved: bytes(23) }),
    ).toThrow();
  });
});

describe('PendingSlashSchema', () => {
  const valid = {
    amount: new BN(1000),
    reasonCode: 3,
    proposedAt: new BN(1700000000),
    executableAt: new BN(1702592000),
    proposer: pk(),
    appealPending: false,
  };

  it('parses well-formed slash record', () => {
    expect(PendingSlashSchema.parse(valid)).toEqual(valid);
  });

  it('rejects non-boolean appealPending', () => {
    expect(() => PendingSlashSchema.parse({ ...valid, appealPending: 'yes' })).toThrow();
  });
});

describe('PendingWithdrawalSchema', () => {
  it('parses a withdrawal', () => {
    const w = {
      amount: new BN(500),
      requestedAt: new BN(1700000000),
      executableAt: new BN(1702592000),
    };
    expect(PendingWithdrawalSchema.parse(w)).toEqual(w);
  });
});

describe('AgentStatusSchema', () => {
  it.each(['active', 'paused', 'suspended', 'deregistered'])('accepts %s', (status) => {
    expect(AgentStatusSchema.parse(status)).toBe(status);
  });

  it('rejects unknown status', () => {
    expect(() => AgentStatusSchema.parse('zombie')).toThrow();
  });
});

describe('AgentAccountSchema', () => {
  const valid = {
    operator: pk(),
    agentId: bytes(32),
    did: bytes(32),
    manifestUri: bytes(128),
    capabilityMask: new BN(0xff),
    priceLamports: new BN(1_000_000),
    streamRate: new BN(0),
    reputation,
    jobsCompleted: new BN(7),
    jobsDisputed: 0,
    stakeAmount: new BN(50_000_000),
    status: { active: {} },
    version: 1,
    registeredAt: new BN(1700000000),
    lastActive: new BN(1700100000),
    delegate: null,
    pendingSlash: null,
    pendingWithdrawal: null,
    bump: 254,
    vaultBump: 253,
  };

  it('parses well-formed account', () => {
    expect(AgentAccountSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a non-null delegate', () => {
    expect(() => AgentAccountSchema.parse({ ...valid, delegate: pk() })).not.toThrow();
  });

  it('rejects manifestUri shorter than 128 bytes', () => {
    expect(() => AgentAccountSchema.parse({ ...valid, manifestUri: bytes(127) })).toThrow();
  });
});

describe('RegistryGlobalSchema', () => {
  const valid = {
    authority: pk(),
    pendingAuthority: null,
    capabilityRegistry: pk(),
    taskMarket: pk(),
    disputeArbitration: pk(),
    slashingTreasury: pk(),
    stakeMint: pk(),
    minStake: new BN(10_000_000),
    maxSlashBps: 1000,
    slashTimelockSecs: new BN(2_592_000),
    paused: false,
    bump: 254,
  };

  it('parses well-formed global', () => {
    expect(RegistryGlobalSchema.parse(valid)).toEqual(valid);
  });

  it('rejects when authority is missing', () => {
    const { authority: _a, ...missing } = valid;
    expect(() => RegistryGlobalSchema.parse(missing)).toThrow();
  });
});

describe('arg schemas', () => {
  it('RegisterAgentArgsSchema parses', () => {
    const out = RegisterAgentArgsSchema.parse({
      agentId: bytes(32),
      manifestUri: bytes(128),
      capabilityMask: new BN(1),
      priceLamports: new BN(1000),
      streamRate: new BN(0),
      stakeAmount: new BN(10_000_000),
    });
    expect(out.agentId).toHaveLength(32);
  });

  it('UpdateManifestArgsSchema rejects wrong-length manifestUri', () => {
    expect(() =>
      UpdateManifestArgsSchema.parse({
        manifestUri: bytes(64),
        capabilityMask: new BN(1),
        priceLamports: new BN(1),
        streamRate: new BN(0),
      }),
    ).toThrow();
  });

  it('StakeIncreaseArgsSchema parses', () => {
    expect(StakeIncreaseArgsSchema.parse({ amount: new BN(1) }).amount.toString()).toBe('1');
  });

  it('StakeWithdrawRequestArgsSchema rejects non-BN amount', () => {
    expect(() => StakeWithdrawRequestArgsSchema.parse({ amount: 1 })).toThrow();
  });
});

describe('JobOutcomeSchema', () => {
  it('parses well-formed outcome', () => {
    const j = {
      success: true,
      qualityBps: 9500,
      timelinessBps: 8800,
      costEfficiencyBps: 9000,
      disputed: false,
    };
    expect(JobOutcomeSchema.parse(j)).toEqual(j);
  });

  it('rejects non-boolean success', () => {
    expect(() =>
      JobOutcomeSchema.parse({
        success: 1,
        qualityBps: 0,
        timelinessBps: 0,
        costEfficiencyBps: 0,
        disputed: false,
      }),
    ).toThrow();
  });
});
