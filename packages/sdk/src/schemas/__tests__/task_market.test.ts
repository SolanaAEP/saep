import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  CreateTaskArgsSchema,
  MarketGlobalSchema,
  SubmitResultArgsSchema,
  TaskContractSchema,
  TaskStatusSchema,
  VerifyTaskArgsSchema,
} from '../task_market.js';

const pk = () => PublicKey.default;
const bytes = (n: number) => Array.from({ length: n }, (_, i) => i % 256);

describe('TaskStatusSchema', () => {
  it.each([
    'created',
    'funded',
    'inExecution',
    'proofSubmitted',
    'verified',
    'released',
    'expired',
    'disputed',
    'resolved',
  ])('accepts %s', (s) => {
    expect(TaskStatusSchema.parse(s)).toBe(s);
  });

  it('rejects unknown status', () => {
    expect(() => TaskStatusSchema.parse('settled')).toThrow();
  });
});

describe('MarketGlobalSchema', () => {
  const valid = {
    authority: pk(),
    pendingAuthority: null,
    agentRegistry: pk(),
    treasuryStandard: pk(),
    proofVerifier: pk(),
    feeCollector: pk(),
    solrepPool: pk(),
    protocolFeeBps: 100,
    solrepFeeBps: 50,
    disputeWindowSecs: new BN(86_400),
    maxDeadlineSecs: new BN(2_592_000),
    allowedPaymentMints: Array.from({ length: 8 }, () => pk()),
    paused: false,
    bump: 254,
  };

  it('parses well-formed global', () => {
    expect(MarketGlobalSchema.parse(valid).allowedPaymentMints).toHaveLength(8);
  });

  it('rejects allowedPaymentMints with wrong length', () => {
    expect(() =>
      MarketGlobalSchema.parse({
        ...valid,
        allowedPaymentMints: Array.from({ length: 7 }, () => pk()),
      }),
    ).toThrow();
  });
});

describe('TaskContractSchema', () => {
  const valid = {
    taskId: bytes(32),
    client: pk(),
    agentDid: bytes(32),
    taskNonce: bytes(8),
    paymentMint: pk(),
    paymentAmount: new BN(1_000_000),
    protocolFee: new BN(10_000),
    solrepFee: new BN(5_000),
    taskHash: bytes(32),
    resultHash: bytes(32),
    proofKey: bytes(32),
    criteriaRoot: bytes(32),
    milestoneCount: 3,
    milestonesComplete: 1,
    status: { funded: {} },
    createdAt: new BN(1700000000),
    fundedAt: new BN(1700000100),
    deadline: new BN(1700086400),
    submittedAt: new BN(0),
    disputeWindowEnd: new BN(0),
    verified: false,
    bump: 254,
    escrowBump: 253,
  };

  it('parses a well-formed contract', () => {
    expect(TaskContractSchema.parse(valid)).toEqual(valid);
  });

  it('rejects taskNonce of wrong length', () => {
    expect(() => TaskContractSchema.parse({ ...valid, taskNonce: bytes(7) })).toThrow();
  });

  it('rejects non-boolean verified', () => {
    expect(() => TaskContractSchema.parse({ ...valid, verified: 0 })).toThrow();
  });
});

describe('CreateTaskArgsSchema', () => {
  it('parses well-formed args', () => {
    const out = CreateTaskArgsSchema.parse({
      taskNonce: bytes(8),
      agentDid: bytes(32),
      paymentMint: pk(),
      paymentAmount: new BN(1_000),
      taskHash: bytes(32),
      criteriaRoot: bytes(32),
      deadline: new BN(1700086400),
      milestoneCount: 1,
    });
    expect(out.milestoneCount).toBe(1);
  });

  it('rejects taskHash of wrong length', () => {
    expect(() =>
      CreateTaskArgsSchema.parse({
        taskNonce: bytes(8),
        agentDid: bytes(32),
        paymentMint: pk(),
        paymentAmount: new BN(1),
        taskHash: bytes(31),
        criteriaRoot: bytes(32),
        deadline: new BN(0),
        milestoneCount: 1,
      }),
    ).toThrow();
  });
});

describe('SubmitResultArgsSchema', () => {
  it('parses well-formed args', () => {
    const out = SubmitResultArgsSchema.parse({
      resultHash: bytes(32),
      proofKey: bytes(32),
    });
    expect(out.resultHash).toHaveLength(32);
  });

  it('rejects proofKey of wrong length', () => {
    expect(() =>
      SubmitResultArgsSchema.parse({ resultHash: bytes(32), proofKey: bytes(31) }),
    ).toThrow();
  });
});

describe('VerifyTaskArgsSchema', () => {
  it('parses well-formed args', () => {
    const out = VerifyTaskArgsSchema.parse({
      proofA: bytes(64),
      proofB: bytes(128),
      proofC: bytes(64),
    });
    expect(out.proofA).toHaveLength(64);
  });

  it('rejects proofA with wrong length', () => {
    expect(() =>
      VerifyTaskArgsSchema.parse({ proofA: bytes(63), proofB: bytes(128), proofC: bytes(64) }),
    ).toThrow();
  });
});
