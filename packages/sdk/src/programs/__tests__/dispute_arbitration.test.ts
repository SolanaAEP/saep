import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/dispute_arbitration.json' with { type: 'json' };
import type { DisputeArbitration } from '../../generated/dispute_arbitration.js';
import {
  disputeConfigPda,
  disputePoolPda,
  arbitratorPda,
  disputeVotePda,
  appealPda,
  pendingSlashPda,
} from '../../pda/index.js';
import {
  buildDisputeRaiseIx,
  buildCommitVoteIx,
  buildRevealVoteIx,
  buildResolveDisputeIx,
  buildEscalateAppealIx,
  buildRegisterArbitratorIx,
  buildSlashArbitratorIx,
  buildTallyRoundIx,
} from '../dispute_arbitration.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa');

const program = makeTestProgram<DisputeArbitration>(idl as Record<string, unknown>, PROG);

const disputeCase = PublicKey.unique();
const payerKey = PublicKey.unique();
const cranker = PublicKey.unique();
const arbitratorSigner = PublicKey.unique();
const operatorKey = PublicKey.unique();
const clientKey = PublicKey.unique();
const agentOperator = PublicKey.unique();
const paymentMint = PublicKey.unique();
const stakeAccount = PublicKey.unique();

describe('buildDisputeRaiseIx', () => {
  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildDisputeRaiseIx(program, {
      disputeCase,
      payer: payerKey,
      taskId: 42n,
      client: clientKey,
      agentOperator,
      escrowAmount: 1000n,
      paymentMint,
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'raise_dispute'));
    const [config] = disputeConfigPda(PROG);
    const [pool] = disputePoolPda(PROG);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      disputeCase.toBase58(),
      pool.toBase58(),
      payerKey.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const ix = await buildDisputeRaiseIx(program, {
      disputeCase,
      payer: payerKey,
      taskId: 777n,
      client: clientKey,
      agentOperator,
      escrowAmount: 5000n,
      paymentMint,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('raise_dispute');
    const data = decoded.data as Record<string, unknown>;
    expect((data.task_id as { toString(): string }).toString()).toBe('777');
    expect((data.escrow_amount as { toString(): string }).toString()).toBe('5000');
  });
});

describe('buildCommitVoteIx', () => {
  const commitHash = new Uint8Array(32).fill(0xab);

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildCommitVoteIx(program, {
      disputeCase,
      arbitratorSigner,
      operator: operatorKey,
      caseId: 1n,
      commitHash,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'commit_vote'));
    const [config] = disputeConfigPda(PROG);
    const [arbitrator] = arbitratorPda(PROG, arbitratorSigner);
    const [voteRecord] = disputeVotePda(PROG, 1n, arbitrator);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      disputeCase.toBase58(),
      arbitrator.toBase58(),
      voteRecord.toBase58(),
      operatorKey.toBase58(),
      arbitratorSigner.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[5].isSigner).toBe(true);
  });

  it('round-trips args', async () => {
    const ix = await buildCommitVoteIx(program, {
      disputeCase,
      arbitratorSigner,
      operator: operatorKey,
      caseId: 2n,
      commitHash,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('commit_vote');
    const data = decoded.data as Record<string, unknown>;
    expect(data.commit_hash).toEqual(Array.from(commitHash));
  });
});

describe('buildRevealVoteIx', () => {
  const salt = new Uint8Array(32).fill(0xfe);
  const verdict = { clientWins: {} } as unknown as Record<string, never>;

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildRevealVoteIx(program, {
      disputeCase,
      arbitratorSigner,
      caseId: 5n,
      verdict,
      salt,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'reveal_vote'));
    const [config] = disputeConfigPda(PROG);
    const [arbitrator] = arbitratorPda(PROG, arbitratorSigner);
    const [voteRecord] = disputeVotePda(PROG, 5n, arbitrator);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      disputeCase.toBase58(),
      arbitrator.toBase58(),
      voteRecord.toBase58(),
      arbitratorSigner.toBase58(),
    ]);
    expect(ix.keys[4].isSigner).toBe(true);
  });

  it('round-trips salt', async () => {
    const ix = await buildRevealVoteIx(program, {
      disputeCase,
      arbitratorSigner,
      caseId: 5n,
      verdict,
      salt,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('reveal_vote');
    const data = decoded.data as Record<string, unknown>;
    expect(data.salt).toEqual(Array.from(salt));
  });
});

describe('buildResolveDisputeIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildResolveDisputeIx(program, { disputeCase, cranker });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'resolve_dispute'));
    const [config] = disputeConfigPda(PROG);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      disputeCase.toBase58(),
      cranker.toBase58(),
    ]);
    expect(ix.keys[2].isSigner).toBe(true);
  });
});

describe('buildEscalateAppealIx', () => {
  const appellant = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildEscalateAppealIx(program, { disputeCase, appellant, caseId: 10n });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'escalate_appeal'));
    const [config] = disputeConfigPda(PROG);
    const [appealRecord] = appealPda(PROG, 10n);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      disputeCase.toBase58(),
      appealRecord.toBase58(),
      appellant.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });
});

describe('buildRegisterArbitratorIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildRegisterArbitratorIx(program, {
      operator: operatorKey,
      stakeAccount,
      effectiveStake: 10000n,
      lockEnd: 99999n,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'register_arbitrator'));
    const [config] = disputeConfigPda(PROG);
    const [arbitrator] = arbitratorPda(PROG, operatorKey);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      arbitrator.toBase58(),
      stakeAccount.toBase58(),
      operatorKey.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it('round-trips args', async () => {
    const ix = await buildRegisterArbitratorIx(program, {
      operator: operatorKey,
      stakeAccount,
      effectiveStake: 50000n,
      lockEnd: 123456n,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('register_arbitrator');
    const data = decoded.data as Record<string, unknown>;
    expect((data.effective_stake as { toString(): string }).toString()).toBe('50000');
    expect((data.lock_end as { toString(): string }).toString()).toBe('123456');
  });
});

describe('buildSlashArbitratorIx', () => {
  const arbitratorOperator = PublicKey.unique();
  const proposer = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildSlashArbitratorIx(program, {
      disputeCase,
      arbitratorOperator,
      proposer,
      reasonCode: 3,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'slash_arbitrator'));
    const [config] = disputeConfigPda(PROG);
    const [arbitrator] = arbitratorPda(PROG, arbitratorOperator);
    const [pendingSlash] = pendingSlashPda(PROG, arbitratorOperator);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      disputeCase.toBase58(),
      arbitrator.toBase58(),
      pendingSlash.toBase58(),
      proposer.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[4].isSigner).toBe(true);
  });

  it('round-trips reasonCode', async () => {
    const ix = await buildSlashArbitratorIx(program, {
      disputeCase,
      arbitratorOperator,
      proposer,
      reasonCode: 7,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('slash_arbitrator');
    expect((decoded.data as { reason_code: number }).reason_code).toBe(7);
  });
});

describe('buildTallyRoundIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildTallyRoundIx(program, { disputeCase, cranker });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'tally_round'));
    expect(accountKeys(ix)).toEqual([disputeCase.toBase58(), cranker.toBase58()]);
    expect(ix.keys[1].isSigner).toBe(true);
  });
});
