import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
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
} from '../../pda/index.js';
import {
  buildCreateTaskIx,
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
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

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
const taskNonce = new Uint8Array(8).fill(0x01);
const agentDid = new Uint8Array(32).fill(0x02);
const agentId = new Uint8Array(32).fill(0x03);
const taskHash = new Uint8Array(32).fill(0x04);
const criteriaRoot = new Uint8Array(32).fill(0x05);
const taskId = new Uint8Array(32).fill(0x06);
const vkId = new Uint8Array(32).fill(0x07);

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
      taskHash,
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
      taskHash,
      criteriaRoot,
      deadline: 12345n,
      milestoneCount: 7,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('create_task');
    const data = decoded.data as Record<string, unknown>;
    expect(data.task_nonce).toEqual(Array.from(taskNonce));
    expect((data.payment_amount as { toString(): string }).toString()).toBe('5000');
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
  it.skip('IDL requires personhood_attestation/capability_tag/hook_allowlist accounts — needs localnet', () => {});
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
  it.skip('IDL requires guard account — needs localnet', () => {});
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
