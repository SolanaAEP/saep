import { describe, it, expect } from 'vitest';
import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/task_market.json' with { type: 'json' };
import type { TaskMarket } from '../../generated/task_market.js';
import {
  marketGlobalPda,
  taskPda,
  taskEscrowPda,
  bidBookPda,
  bondEscrowPda,
  bidPda,
  agentAccountPda,
  agentRegistryGlobalPda,
  verifierConfigPda,
  verifierKeyPda,
  verifierModePda,
  reentrancyGuardPda,
} from '../../pda/index.js';
import {
  buildCreateTaskIx,
  buildDisputedTimeoutRefundIx,
  buildFundTaskIx,
  buildSubmitResultIx,
  buildVerifyTaskIx,
  buildReleaseIx,
  buildExpireIx,
  buildRaiseDisputeIx,
  buildOpenBiddingIx,
  buildCommitBidIx,
  buildRevealBidIx,
  buildCloseBiddingIx,
  buildClaimBondIx,
  buildCancelBiddingIx,
  buildCancelUnfundedTaskIx,
} from '../task_market.js';
import { makeTestProgram, makeRecordingProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const program = makeTestProgram<TaskMarket>(idl as Record<string, unknown>, PROG);

const clusterConfig = {
  cluster: 'devnet' as const,
  endpoint: 'http://127.0.0.1:8899',
  programIds: {
    agentRegistry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
    treasuryStandard: PublicKey.unique(),
    taskMarket: PROG,
    disputeArbitration: PublicKey.unique(),
    governanceProgram: PublicKey.unique(),
    feeCollector: PublicKey.unique(),
    proofVerifier: new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe'),
    capabilityRegistry: PublicKey.unique(),
    nxsStaking: PublicKey.unique(),
    templateRegistry: PublicKey.unique(),
  },
};

const client = PublicKey.unique();
const cranker = PublicKey.unique();
const operator = PublicKey.unique();
const bidder = PublicKey.unique();
const paymentMint = PublicKey.unique();
const clientTokenAccount = PublicKey.unique();
const taskNonce = new Uint8Array(8).fill(0x01);
const agentDid = new Uint8Array(32).fill(0x02);
const agentId = new Uint8Array(32).fill(0x03);
const criteriaRoot = new Uint8Array(32).fill(0x05);
const taskId = new Uint8Array(32).fill(0x06);
const vkId = new Uint8Array(32).fill(0x07);
const payload = {
  kind: {
    type: 'generic' as const,
    capabilityBit: 0,
    argsHash: new Uint8Array(32).fill(0x04),
  },
  capabilityBit: 0,
  criteria: new Uint8Array([0x62, 0x6c, 0x69, 0x6e, 0x6b]),
  requiresPersonhood: 'none' as const,
};

describe('buildCreateTaskIx', () => {
  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildCreateTaskIx(program, clusterConfig, {
      client,
      taskNonce,
      agentDid,
      agentOperator: operator,
      agentId,
      paymentMint,
      paymentAmount: 1000n,
      payload,
      criteriaRoot,
      deadline: 9999n,
      milestoneCount: 3,
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'create_task'));
    const [global] = marketGlobalPda(PROG);
    const [task] = taskPda(PROG, client, taskNonce);
    const [registryGlobal] = agentRegistryGlobalPda(clusterConfig.programIds.agentRegistry);
    const [agentAccount] = agentAccountPda(clusterConfig.programIds.agentRegistry, operator, agentId);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      task.toBase58(),
      client.toBase58(),
      clusterConfig.programIds.agentRegistry.toBase58(),
      registryGlobal.toBase58(),
      agentAccount.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[2].isSigner).toBe(true);
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const ix = await buildCreateTaskIx(program, clusterConfig, {
      client,
      taskNonce,
      agentDid,
      agentOperator: operator,
      agentId,
      paymentMint,
      paymentAmount: 5000n,
      payload,
      criteriaRoot,
      deadline: 12345n,
      milestoneCount: 7,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('create_task');
    const data = decoded.data as Record<string, unknown>;
    expect(data.task_nonce).toEqual(Array.from(taskNonce));
    expect((data.payment_amount as { toString(): string }).toString()).toBe('5000');
    expect(data.payload).toMatchObject({
      capability_bit: 0,
      requires_personhood: { None: {} },
    });
    expect((data.deadline as { toString(): string }).toString()).toBe('12345');
    expect(data.milestone_count).toBe(7);
  });
});

describe('buildFundTaskIx', () => {
  const task = PublicKey.unique();
  const clientTokenAccount = PublicKey.unique();

  it.skip('returns ix with correct discriminator + accounts (IDL requires hook_allowlist/guard — needs localnet)', async () => {
    const ix = await buildFundTaskIx(program, { client, task, paymentMint, clientTokenAccount });
    expect(ix.programId.equals(PROG)).toBe(true);
  });
});

describe('buildSubmitResultIx', () => {
  it.skip('IDL requires guard account — needs localnet', () => {});
});

describe('buildVerifyTaskIx', () => {
  it.skip('IDL requires guard/verifierSelfGuard/instructions accounts — needs localnet', () => {});
});

describe('buildReleaseIx', () => {
  it.skip('IDL requires hook_allowlist/guard accounts — needs localnet', () => {});
});

describe('buildExpireIx', () => {
  it.skip('IDL requires hook_allowlist/guard accounts — needs localnet', () => {});
});

describe('buildRaiseDisputeIx', () => {
  const task = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildRaiseDisputeIx(program, { client, task });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'raise_dispute'));
    expect(accountKeys(ix)).toEqual([task.toBase58(), client.toBase58()]);
    expect(ix.keys[1].isSigner).toBe(true);
  });
});

describe('buildOpenBiddingIx', () => {
  const task = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildOpenBiddingIx(program, {
      client,
      task,
      taskId,
      paymentMint,
      commitSecs: 300n,
      revealSecs: 600n,
      bondBps: 500,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'open_bidding'));
    const [global] = marketGlobalPda(PROG);
    const [bidBook] = bidBookPda(PROG, taskId);
    const [bondEscrow] = bondEscrowPda(PROG, taskId);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      task.toBase58(),
      bidBook.toBase58(),
      paymentMint.toBase58(),
      bondEscrow.toBase58(),
      client.toBase58(),
      TOKEN_2022.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[5].isSigner).toBe(true);
  });

  it('round-trips args', async () => {
    const ix = await buildOpenBiddingIx(program, {
      client,
      task,
      taskId,
      paymentMint,
      commitSecs: 120n,
      revealSecs: 240n,
      bondBps: 1000,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('open_bidding');
    const data = decoded.data as Record<string, unknown>;
    expect((data.commit_secs as { toString(): string }).toString()).toBe('120');
    expect((data.reveal_secs as { toString(): string }).toString()).toBe('240');
    expect(data.bond_bps).toBe(1000);
  });
});

describe('buildCommitBidIx', () => {
  it('returns ix with explicit null optional accounts and registry global', async () => {
    const task = PublicKey.unique();
    const bidderTokenAccount = PublicKey.unique();
    const ix = await buildCommitBidIx(program, clusterConfig, {
      bidder,
      task,
      taskId,
      paymentMint,
      bidderTokenAccount,
      agentOperator: operator,
      agentId,
      agentDid,
      commitHash: new Uint8Array(32).fill(0xaa),
    });
    const [global] = marketGlobalPda(PROG);
    const [book] = bidBookPda(PROG, taskId);
    const [bid] = bidPda(PROG, taskId, bidder);
    const [bondEscrow] = bondEscrowPda(PROG, taskId);
    const [registryGlobal] = agentRegistryGlobalPda(clusterConfig.programIds.agentRegistry);
    const [agentAccount] = agentAccountPda(clusterConfig.programIds.agentRegistry, operator, agentId);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      task.toBase58(),
      book.toBase58(),
      bid.toBase58(),
      paymentMint.toBase58(),
      bondEscrow.toBase58(),
      bidderTokenAccount.toBase58(),
      bidder.toBase58(),
      clusterConfig.programIds.agentRegistry.toBase58(),
      registryGlobal.toBase58(),
      agentAccount.toBase58(),
      PROG.toBase58(),
      PROG.toBase58(),
      PROG.toBase58(),
      TOKEN_2022.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[7].isSigner).toBe(true);
  });
});

describe('buildRevealBidIx', () => {
  const task = PublicKey.unique();
  const nonce = new Uint8Array(32).fill(0xdd);

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildRevealBidIx(program, { bidder, task, taskId, amount: 500n, nonce });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'reveal_bid'));
    const [book] = bidBookPda(PROG, taskId);
    const [b] = bidPda(PROG, taskId, bidder);
    expect(accountKeys(ix)).toEqual([
      task.toBase58(),
      book.toBase58(),
      b.toBase58(),
      bidder.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it('round-trips args', async () => {
    const ix = await buildRevealBidIx(program, { bidder, task, taskId, amount: 9999n, nonce });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('reveal_bid');
    const data = decoded.data as Record<string, unknown>;
    expect((data.amount as { toString(): string }).toString()).toBe('9999');
    expect(data.nonce).toEqual(Array.from(nonce));
  });
});

describe('buildCloseBiddingIx', () => {
  it('includes the reentrancy guard account', async () => {
    const task = PublicKey.unique();
    const ix = await buildCloseBiddingIx(program, {
      cranker,
      task,
      taskId,
    });
    const [global] = marketGlobalPda(PROG);
    const [book] = bidBookPda(PROG, taskId);
    const [guard] = reentrancyGuardPda(PROG);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      task.toBase58(),
      book.toBase58(),
      guard.toBase58(),
      cranker.toBase58(),
    ]);
    expect(ix.keys[4].isSigner).toBe(true);
  });
});

describe('buildClaimBondIx', () => {
  it.skip('IDL requires hook_allowlist account — needs localnet', () => {});
});

describe('buildCancelBiddingIx', () => {
  const task = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildCancelBiddingIx(program, { client, task, taskId, paymentMint });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'cancel_bidding'));
    const [book] = bidBookPda(PROG, taskId);
    const [bondEscrow] = bondEscrowPda(PROG, taskId);
    expect(accountKeys(ix)).toEqual([
      task.toBase58(),
      book.toBase58(),
      paymentMint.toBase58(),
      bondEscrow.toBase58(),
      client.toBase58(),
      TOKEN_2022.toBase58(),
    ]);
    expect(ix.keys[4].isSigner).toBe(true);
  });
});

describe('buildCancelUnfundedTaskIx', () => {
  const task = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildCancelUnfundedTaskIx(program, { client, task });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'cancel_unfunded_task'));
    expect(accountKeys(ix)).toEqual([task.toBase58(), client.toBase58()]);
    expect(ix.keys[1].isSigner).toBe(true);
  });
});

describe('recording-program task-market coverage', () => {
  it('normalizes create-task payload variants and personhood tiers', async () => {
    const { program: recordingProgram, calls } = makeRecordingProgram<TaskMarket>(PROG);

    await buildCreateTaskIx(recordingProgram, clusterConfig, {
      client,
      taskNonce,
      agentDid,
      agentOperator: operator,
      agentId,
      paymentMint,
      paymentAmount: 11n,
      payload: {
        kind: {
          type: 'swapExact',
          inMint: PublicKey.unique(),
          outMint: PublicKey.unique(),
          amountIn: 42n,
          minOut: 7n,
        },
        capabilityBit: 2,
        criteria: Uint8Array.from([1, 2, 3]),
        requiresPersonhood: 'basic',
      },
      criteriaRoot,
      deadline: 101n,
      milestoneCount: 1,
    });

    await buildCreateTaskIx(recordingProgram, clusterConfig, {
      client,
      taskNonce,
      agentDid,
      agentOperator: operator,
      agentId,
      paymentMint,
      paymentAmount: 12n,
      payload: {
        kind: {
          transfer: {
            mint: PublicKey.unique(),
            to: PublicKey.unique(),
            amount: 9n,
          },
        },
        capabilityBit: 3,
        criteria: Uint8Array.from([4, 5]),
        requiresPersonhood: { verified: {} },
      },
      criteriaRoot,
      deadline: 102n,
      milestoneCount: 2,
    });

    await buildCreateTaskIx(recordingProgram, clusterConfig, {
      client,
      taskNonce,
      agentDid,
      agentOperator: operator,
      agentId,
      paymentMint,
      paymentAmount: 13n,
      payload: {
        kind: {
          dataFetch: {
            urlHash: new Uint8Array(32).fill(0x11),
            expectedHash: new Uint8Array(32).fill(0x22),
          },
        },
        capabilityBit: 4,
        criteria: Uint8Array.from([6]),
        requiresPersonhood: { none: {} },
      },
      criteriaRoot,
      deadline: 103n,
      milestoneCount: 3,
    });

    await buildCreateTaskIx(recordingProgram, clusterConfig, {
      client,
      taskNonce,
      agentDid,
      agentOperator: operator,
      agentId,
      paymentMint,
      paymentAmount: 14n,
      payload: {
        kind: {
          compute: {
            circuitId: new Uint8Array(32).fill(0x33),
            publicInputsHash: new Uint8Array(32).fill(0x44),
          },
        },
        capabilityBit: 5,
        criteria: Uint8Array.from([7, 8]),
        requiresPersonhood: undefined,
      },
      criteriaRoot,
      deadline: 104n,
      milestoneCount: 4,
    });

    const [swapCall, transferCall, dataFetchCall, computeCall] = calls;
    expect(swapCall?.method).toBe('createTask');
    expect((swapCall?.args[4] as { kind: Record<string, unknown>; requiresPersonhood: unknown }).kind).toHaveProperty(
      'swapExact',
    );
    expect((swapCall?.args[4] as { requiresPersonhood: unknown }).requiresPersonhood).toEqual({ basic: {} });
    expect((transferCall?.args[4] as { kind: Record<string, unknown>; requiresPersonhood: unknown }).kind).toHaveProperty(
      'transfer',
    );
    expect((transferCall?.args[4] as { requiresPersonhood: unknown }).requiresPersonhood).toEqual({
      verified: {},
    });
    expect((dataFetchCall?.args[4] as { kind: Record<string, unknown>; requiresPersonhood: unknown }).kind).toHaveProperty(
      'dataFetch',
    );
    expect((dataFetchCall?.args[4] as { requiresPersonhood: unknown }).requiresPersonhood).toEqual({
      none: {},
    });
    expect((computeCall?.args[4] as { kind: Record<string, unknown>; requiresPersonhood: unknown }).kind).toHaveProperty(
      'compute',
    );
    expect((computeCall?.args[4] as { requiresPersonhood: unknown }).requiresPersonhood).toEqual({ none: {} });
  });

  it('rejects malformed create-task payload hashes', async () => {
    const { program: recordingProgram } = makeRecordingProgram<TaskMarket>(PROG);

    await expect(
      buildCreateTaskIx(recordingProgram, clusterConfig, {
        client,
        taskNonce,
        agentDid,
        agentOperator: operator,
        agentId,
        paymentMint,
        paymentAmount: 1n,
        payload: {
          kind: {
            generic: {
              capabilityBit: 1,
              argsHash: new Uint8Array(31),
            },
          },
          capabilityBit: 1,
          criteria: Uint8Array.from([1]),
        },
        criteriaRoot,
        deadline: 1n,
        milestoneCount: 1,
      }),
    ).rejects.toThrow('payload.kind.argsHash must be 32 bytes');
  });

  it('covers the remaining task lifecycle builders without localnet account resolution', async () => {
    const { program: recordingProgram, calls } = makeRecordingProgram<TaskMarket>(PROG);
    const task = PublicKey.unique();
    const customTokenProgram = PublicKey.unique();
    const customHookAllowlist = PublicKey.unique();

    await buildFundTaskIx(recordingProgram, {
      client,
      task,
      paymentMint,
      clientTokenAccount,
    });
    await buildSubmitResultIx(recordingProgram, clusterConfig, {
      operator,
      task,
      agentAccount: PublicKey.unique(),
      resultHash: new Uint8Array(32).fill(0x51),
      proofKey: new Uint8Array(32).fill(0x52),
    });
    await buildVerifyTaskIx(recordingProgram, clusterConfig, {
      cranker,
      task,
      verifierKey: PublicKey.unique(),
      vkId,
      proofA: new Uint8Array(32).fill(0x61),
      proofB: new Uint8Array(64).fill(0x62),
      proofC: new Uint8Array(32).fill(0x63),
    });
    await buildReleaseIx(recordingProgram, clusterConfig, {
      cranker,
      task,
      paymentMint,
      agentTokenAccount: PublicKey.unique(),
      feeCollectorTokenAccount: PublicKey.unique(),
      solrepPoolTokenAccount: PublicKey.unique(),
      agentAccount: PublicKey.unique(),
      client,
      hookAllowlist: customHookAllowlist,
      tokenProgramId: customTokenProgram,
    });
    await buildExpireIx(recordingProgram, clusterConfig, {
      cranker,
      task,
      paymentMint,
      clientTokenAccount,
      client,
      agentAccount: PublicKey.unique(),
      tokenProgramId: customTokenProgram,
    });
    await buildDisputedTimeoutRefundIx(recordingProgram, {
      cranker,
      client,
      task,
      paymentMint,
      clientTokenAccount,
      tokenProgramId: customTokenProgram,
    });
    await buildCommitBidIx(recordingProgram, clusterConfig, {
      bidder,
      task,
      taskId,
      paymentMint,
      bidderTokenAccount: PublicKey.unique(),
      agentOperator: operator,
      agentId,
      agentDid,
      commitHash: new Uint8Array(32).fill(0x71),
      tokenProgramId: customTokenProgram,
    });
    await buildCloseBiddingIx(recordingProgram, {
      cranker,
      task,
      taskId,
    });
    await buildClaimBondIx(recordingProgram, {
      bidder,
      task,
      taskId,
      paymentMint,
      bidderTokenAccount: PublicKey.unique(),
      feeCollectorTokenAccount: PublicKey.unique(),
      tokenProgramId: customTokenProgram,
    });
    await buildCancelBiddingIx(recordingProgram, {
      client,
      task,
      taskId,
      paymentMint,
      tokenProgramId: customTokenProgram,
    });
    await buildCancelUnfundedTaskIx(recordingProgram, {
      client,
      task,
    });

    expect(calls.map((call) => call.method)).toEqual([
      'fundTask',
      'submitResult',
      'verifyTask',
      'release',
      'expire',
      'disputedTimeoutRefund',
      'commitBid',
      'closeBidding',
      'claimBond',
      'cancelBidding',
      'cancelUnfundedTask',
    ]);

    expect(calls[0]?.accounts.hookAllowlist).toBeNull();
    expect((calls[0]?.accounts.tokenProgram as PublicKey).equals(TOKEN_2022)).toBe(true);
    expect(calls[1]?.args).toEqual([
      Array.from(new Uint8Array(32).fill(0x51)),
      Array.from(new Uint8Array(32).fill(0x52)),
    ]);
    expect(calls[2]?.accounts.instructions).toEqual(SYSVAR_INSTRUCTIONS_PUBKEY);
    expect((calls[3]?.accounts.hookAllowlist as PublicKey).equals(customHookAllowlist)).toBe(true);
    expect((calls[3]?.accounts.tokenProgram as PublicKey).equals(customTokenProgram)).toBe(true);
    expect((calls[4]?.accounts.tokenProgram as PublicKey).equals(customTokenProgram)).toBe(true);
    expect((calls[5]?.accounts.tokenProgram as PublicKey).equals(customTokenProgram)).toBe(true);
    expect(calls[6]?.args[0]).toEqual(Array.from(new Uint8Array(32).fill(0x71)));
    expect((calls[6]?.accounts.tokenProgram as PublicKey).equals(customTokenProgram)).toBe(true);
    expect((calls[8]?.accounts.tokenProgram as PublicKey).equals(customTokenProgram)).toBe(true);
    expect((calls[9]?.accounts.tokenProgram as PublicKey).equals(customTokenProgram)).toBe(true);
    expect(calls[10]?.accounts).toEqual({
      task,
      client,
    });
  });
});
