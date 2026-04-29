import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { startBankrun, loadBankrunProgram, warpClockBy } from './helpers/bankrun.js';

import type { DisputeArbitration } from '../target/types/dispute_arbitration';

const enc = (s: string) => Buffer.from(s);

function u64Le(id: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(id));
  return buf;
}

function computeCommitHash(verdictByte: number, salt: Uint8Array): number[] {
  const hash = createHash('sha256')
    .update(Buffer.from([verdictByte]))
    .update(salt)
    .digest();
  return Array.from(hash);
}

const PROGRAM_ID = new PublicKey('GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa');

function disputeConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('dispute_config')], PROGRAM_ID);
}

function guardPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('guard')], PROGRAM_ID);
}

function arbitratorPda(operator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('arbitrator'), operator.toBuffer()], PROGRAM_ID);
}

function disputePoolPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('dispute_pool')], PROGRAM_ID);
}

function disputeCasePda(caseId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('dispute_case'), u64Le(caseId)], PROGRAM_ID);
}

function disputeVotePda(caseId: number, arbitratorSigner: PublicKey, round: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc('dispute_vote'), u64Le(caseId), arbitratorSigner.toBuffer(), Buffer.from([round])],
    PROGRAM_ID,
  );
}

function appealPda(caseId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('appeal'), u64Le(caseId)], PROGRAM_ID);
}

const COMMIT_WINDOW = 10;
const REVEAL_WINDOW = 10;
const APPEAL_WINDOW = 10;
const SLASH_TIMELOCK = 5;
const MIN_STAKE = 1_000_000;
const MIN_LOCK_SECS = 60;

describe('bankrun: dispute_arbitration', function () {
  this.timeout(120_000);

  let context: Awaited<ReturnType<typeof startBankrun>>['context'];
  let provider: Awaited<ReturnType<typeof startBankrun>>['provider'];
  let program: anchor.Program<DisputeArbitration>;
  let authority: Keypair;

  // nxs_staking program id — used as owner for fake stake accounts
  const nxsStaking = Keypair.generate();
  const taskMarket = Keypair.generate();
  const feeCollector = Keypair.generate();
  const agentRegistry = Keypair.generate();
  const switchboardProgram = Keypair.generate();
  const emergencyCouncil = Keypair.generate();

  // 5 arbitrator operators
  const operators: Keypair[] = Array.from({ length: 5 }, () => Keypair.generate());
  const stakeAccounts: Keypair[] = Array.from({ length: 5 }, () => Keypair.generate());

  const client = Keypair.generate();
  const agentOperator = Keypair.generate();
  const paymentMint = Keypair.generate();

  function fundAccount(kp: Keypair) {
    context.setAccount(kp.publicKey, {
      lamports: 100 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
  }

  function createFakeStakeAccount(kp: Keypair) {
    context.setAccount(kp.publicKey, {
      lamports: LAMPORTS_PER_SOL,
      data: Buffer.alloc(64),
      owner: nxsStaking.publicKey,
      executable: false,
    });
  }

  before(async () => {
    const env = await startBankrun();
    context = env.context;
    provider = env.provider;
    authority = context.payer;
    program = loadBankrunProgram<DisputeArbitration>('dispute_arbitration', provider);

    for (const kp of [...operators, client, agentOperator]) {
      fundAccount(kp);
    }
    for (const kp of stakeAccounts) {
      createFakeStakeAccount(kp);
    }
  });

  // ---------- 1. initialize ----------
  it('1. initialize — config + guard seeds created', async () => {
    await program.methods
      .initialize({
        authority: authority.publicKey,
        taskMarket: taskMarket.publicKey,
        nxsStaking: nxsStaking.publicKey,
        feeCollector: feeCollector.publicKey,
        agentRegistry: agentRegistry.publicKey,
        switchboardProgram: switchboardProgram.publicKey,
        emergencyCouncil: emergencyCouncil.publicKey,
        minStake: new BN(MIN_STAKE),
        minLockSecs: new BN(MIN_LOCK_SECS),
      })
      .accountsPartial({ payer: authority.publicKey })
      .rpc();

    const [configKey] = disputeConfigPda();
    const config = await program.account.disputeConfig.fetch(configKey);
    expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(config.minStake.toNumber()).to.equal(MIN_STAKE);
    expect(config.nextCaseId.toNumber()).to.equal(0);
    expect(config.paused).to.equal(false);
  });

  // ---------- 2. init_guard + register_arbitrator ----------
  it('2. init_guard + register_arbitrator — arbitrator Active', async () => {
    const [configKey] = disputeConfigPda();

    await program.methods
      .initGuard([])
      .accountsPartial({
        config: configKey,
        authority: authority.publicKey,
      })
      .rpc();

    const [guardKey] = guardPda();
    const guard = await program.account.reentrancyGuard.fetch(guardKey);
    expect(guard.active).to.equal(false);

    // shorten windows via set_params before registering
    await program.methods
      .setParams({
        commitWindowSecs: new BN(COMMIT_WINDOW),
        revealWindowSecs: new BN(REVEAL_WINDOW),
        appealWindowSecs: new BN(APPEAL_WINDOW),
        appealCollateralBps: null,
        maxSlashBps: null,
        slashTimelockSecs: new BN(SLASH_TIMELOCK),
        minStake: null,
        minLockSecs: null,
        vrfStaleSlots: null,
        badFaithThreshold: null,
        badFaithLookback: null,
      })
      .accountsPartial({
        config: configKey,
        authority: authority.publicKey,
      })
      .rpc();

    const clock = await context.banksClient.getClock();
    const lockEnd = Number(clock.unixTimestamp) + MIN_LOCK_SECS + 600;

    await program.methods
      .registerArbitrator(new BN(MIN_STAKE * 2), new BN(lockEnd))
      .accountsPartial({
        config: configKey,
        stakeAccount: stakeAccounts[0]!.publicKey,
        operator: operators[0]!.publicKey,
      })
      .signers([operators[0]!])
      .rpc();

    const [arbKey] = arbitratorPda(operators[0]!.publicKey);
    const arb = await program.account.arbitratorAccount.fetch(arbKey);
    expect(arb.operator.toBase58()).to.equal(operators[0]!.publicKey.toBase58());
    expect(arb.effectiveStake.toNumber()).to.equal(MIN_STAKE * 2);
    expect(Object.keys(arb.status)[0]).to.equal('active');
  });

  // ---------- 3. register_arbitrator below min_stake ----------
  it('3. register_arbitrator below min_stake — StakeInsufficient', async () => {
    const lowStakeOp = Keypair.generate();
    const lowStakeAcct = Keypair.generate();
    fundAccount(lowStakeOp);
    createFakeStakeAccount(lowStakeAcct);

    const clock = await context.banksClient.getClock();
    const lockEnd = Number(clock.unixTimestamp) + MIN_LOCK_SECS + 600;
    const [configKey] = disputeConfigPda();

    let err: unknown;
    try {
      await program.methods
        .registerArbitrator(new BN(MIN_STAKE - 1), new BN(lockEnd))
        .accountsPartial({
          config: configKey,
          stakeAccount: lowStakeAcct.publicKey,
          operator: lowStakeOp.publicKey,
        })
        .signers([lowStakeOp])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/StakeInsufficient/);
  });

  // ---------- register remaining 4 arbitrators (setup for pool) ----------
  it('registers remaining arbitrators for pool', async () => {
    const [configKey] = disputeConfigPda();
    const clock = await context.banksClient.getClock();
    const lockEnd = Number(clock.unixTimestamp) + MIN_LOCK_SECS + 600;

    for (let i = 1; i < 5; i++) {
      await program.methods
        .registerArbitrator(new BN(MIN_STAKE * (i + 1)), new BN(lockEnd))
        .accountsPartial({
          config: configKey,
          stakeAccount: stakeAccounts[i]!.publicKey,
          operator: operators[i]!.publicKey,
        })
        .signers([operators[i]!])
        .rpc();
    }
  });

  // ---------- 4. snapshot_pool ----------
  it('4. snapshot_pool — pool with cumulative_stakes', async () => {
    const [configKey] = disputeConfigPda();
    const arbPubkeys = operators.map((o) => o.publicKey);
    const stakes = operators.map((_, i) => new BN(MIN_STAKE * (i + 1)));

    // Pre-allocate the pool account — its INIT_SPACE (10,291 bytes) exceeds
    // the 10,240-byte inner-instruction realloc limit, so init_if_needed
    // can't create it via CPI. Seeding a zero-data account at the PDA lets
    // the program write into it without hitting the realloc cap.
    const [poolKey] = disputePoolPda();
    const POOL_SPACE = 8 + 10283; // discriminator + InitSpace
    const poolData = Buffer.alloc(POOL_SPACE, 0);
    // Write the Anchor discriminator so init_if_needed treats it as existing
    Buffer.from([149, 179, 47, 36, 73, 3, 87, 69]).copy(poolData);
    context.setAccount(poolKey, {
      lamports: 100 * LAMPORTS_PER_SOL,
      data: poolData,
      owner: PROGRAM_ID,
      executable: false,
    });

    await program.methods
      .snapshotPool(arbPubkeys, stakes)
      .accountsPartial({
        config: configKey,
        authority: authority.publicKey,
      })
      .rpc();

    const pool = await program.account.disputePool.fetch(poolKey);
    expect(pool.arbitratorCount).to.equal(5);
    expect(pool.arbitrators.length).to.equal(5);
    expect(pool.cumulativeStakes.length).to.equal(5);

    let running = 0;
    for (let i = 0; i < 5; i++) {
      running += MIN_STAKE * (i + 1);
      expect(pool.cumulativeStakes[i]!.toNumber()).to.equal(running);
    }
  });

  // ---------- 5. raise_dispute ----------
  it('5. raise_dispute — case in RequestedVrf status', async () => {
    const [configKey] = disputeConfigPda();
    const [poolKey] = disputePoolPda();
    const [caseKey] = disputeCasePda(0);

    await program.methods
      .raiseDispute(
        new BN(42),
        client.publicKey,
        agentOperator.publicKey,
        new BN(100_000),
        paymentMint.publicKey,
      )
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey,
        pool: poolKey,
        payer: authority.publicKey,
      })
      .rpc();

    const dc = await program.account.disputeCase.fetch(caseKey);
    expect(dc.caseId.toNumber()).to.equal(0);
    expect(dc.taskId.toNumber()).to.equal(42);
    expect(Object.keys(dc.status)[0]).to.equal('requestedVrf');
    expect(dc.round).to.equal(1);

    const config = await program.account.disputeConfig.fetch(configKey);
    expect(config.nextCaseId.toNumber()).to.equal(1);
  });

  // ---------- 6. consume_vrf ----------
  let selectedArbitrators: PublicKey[] = [];

  it('6. consume_vrf — arbitrators selected, Committing status', async () => {
    const [configKey] = disputeConfigPda();
    const [caseKey] = disputeCasePda(0);
    const [poolKey] = disputePoolPda();

    const vrfResult = Array.from(
      createHash('sha256').update(Buffer.from('test-vrf-seed')).digest(),
    );

    await program.methods
      .consumeVrf(vrfResult)
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey,
        pool: poolKey,
        authority: authority.publicKey,
      })
      .rpc();

    const dc = await program.account.disputeCase.fetch(caseKey);
    expect(Object.keys(dc.status)[0]).to.equal('committing');
    expect(dc.arbitratorCount).to.equal(3);
    expect(dc.arbitrators.length).to.equal(3);
    expect(dc.commitDeadline.toNumber()).to.be.greaterThan(0);
    expect(dc.revealDeadline.toNumber()).to.be.greaterThan(dc.commitDeadline.toNumber());

    selectedArbitrators = dc.arbitrators;
  });

  // ---------- 7. commit_vote + reveal_vote ----------
  const salts: Uint8Array[] = [];
  const verdicts: number[] = []; // 1=AgentWins, 2=ClientWins, 3=Split

  it('7. commit_vote + reveal_vote — full cycle', async () => {
    const [configKey] = disputeConfigPda();
    const [caseKey] = disputeCasePda(0);

    // commit phase: all 3 selected arbitrators vote AgentWins (2 of 3 = majority)
    for (let i = 0; i < selectedArbitrators.length; i++) {
      const arbPubkey = selectedArbitrators[i]!;
      const operatorKp = operators.find((o) => o.publicKey.equals(arbPubkey))!;
      expect(operatorKp).to.not.be.undefined;

      const salt = createHash('sha256')
        .update(Buffer.from(`salt-${i}`))
        .digest();
      salts.push(salt);

      // first two vote AgentWins, third votes ClientWins
      const verdictByte = i < 2 ? 1 : 2;
      verdicts.push(verdictByte);

      const commitHash = computeCommitHash(verdictByte, salt);
      const [voteKey] = disputeVotePda(0, operatorKp.publicKey, 1);

      await program.methods
        .commitVote(commitHash)
        .accountsPartial({
          config: configKey,
          disputeCase: caseKey,
          arbitrator: arbitratorPda(operatorKp.publicKey)[0],
          voteRecord: voteKey,
          operator: operatorKp.publicKey,
          arbitratorSigner: operatorKp.publicKey,
        })
        .signers([operatorKp])
        .rpc();
    }

    // warp past commit deadline
    await warpClockBy(context, COMMIT_WINDOW + 1);

    // reveal phase
    for (let i = 0; i < selectedArbitrators.length; i++) {
      const arbPubkey = selectedArbitrators[i]!;
      const operatorKp = operators.find((o) => o.publicKey.equals(arbPubkey))!;

      const verdictEnum =
        verdicts[i] === 1
          ? { agentWins: {} }
          : verdicts[i] === 2
            ? { clientWins: {} }
            : { split: {} };

      const [voteKey] = disputeVotePda(0, operatorKp.publicKey, 1);

      await program.methods
        .revealVote(verdictEnum, Array.from(salts[i]!))
        .accountsPartial({
          config: configKey,
          disputeCase: caseKey,
          arbitrator: arbitratorPda(operatorKp.publicKey)[0],
          voteRecord: voteKey,
          arbitratorSigner: operatorKp.publicKey,
        })
        .signers([operatorKp])
        .rpc();
    }

    const dc = await program.account.disputeCase.fetch(caseKey);
    expect(Object.keys(dc.status)[0]).to.equal('revealing');
    expect(Number(dc.votesForAgent)).to.be.greaterThan(0);
    expect(Number(dc.totalRevealedWeight)).to.be.greaterThan(0);
  });

  // ---------- 8. tally_round ----------
  // (run before deadline tests to stay within case 0's appeal window)
  it('8. tally_round — verdict AgentWins, Tallied status', async () => {
    const [caseKey] = disputeCasePda(0);

    // warp past reveal deadline for case 0
    await warpClockBy(context, REVEAL_WINDOW + 1);

    await program.methods
      .tallyRound()
      .accountsPartial({
        disputeCase: caseKey,
        cranker: authority.publicKey,
      })
      .rpc();

    const dc = await program.account.disputeCase.fetch(caseKey);
    expect(Object.keys(dc.status)[0]).to.equal('tallied');
    expect(Object.keys(dc.verdict)[0]).to.equal('agentWins');
  });

  // ---------- 9. escalate_appeal ----------
  it('9. escalate_appeal — by losing party (client), creates AppealRecord', async () => {
    const [configKey] = disputeConfigPda();
    const [caseKey] = disputeCasePda(0);
    const [appealKey] = appealPda(0);

    await program.methods
      .escalateAppeal()
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey,
        appealRecord: appealKey,
        appellant: client.publicKey,
      })
      .signers([client])
      .rpc();

    const appeal = await program.account.appealRecord.fetch(appealKey);
    expect(appeal.caseId.toNumber()).to.equal(0);
    expect(appeal.appellant.toBase58()).to.equal(client.publicKey.toBase58());
    expect(appeal.round).to.equal(2);

    const dc = await program.account.disputeCase.fetch(caseKey);
    expect(Object.keys(dc.status)[0]).to.equal('appealed');
    expect(dc.round).to.equal(2);
  });

  // ---------- 10. commit_vote after deadline ----------
  it('10. commit_vote after deadline — CommitWindowClosed', async () => {
    const [configKeyFresh] = disputeConfigPda();
    const config = await program.account.disputeConfig.fetch(configKeyFresh);
    const caseId1 = config.nextCaseId.toNumber();
    const [caseKey1] = disputeCasePda(caseId1);
    const [poolKey] = disputePoolPda();

    await program.methods
      .raiseDispute(
        new BN(99),
        client.publicKey,
        agentOperator.publicKey,
        new BN(50_000),
        paymentMint.publicKey,
      )
      .accountsPartial({
        config: configKeyFresh,
        disputeCase: caseKey1,
        pool: poolKey,
        payer: authority.publicKey,
      })
      .rpc();

    const vrfResult2 = Array.from(
      createHash('sha256').update(Buffer.from('test-vrf-seed-2')).digest(),
    );
    await program.methods
      .consumeVrf(vrfResult2)
      .accountsPartial({
        config: configKeyFresh,
        disputeCase: caseKey1,
        pool: poolKey,
        authority: authority.publicKey,
      })
      .rpc();

    const dc1 = await program.account.disputeCase.fetch(caseKey1);
    const arb1 = dc1.arbitrators[0]!;
    const arbOp = operators.find((o) => o.publicKey.equals(arb1))!;

    await warpClockBy(context, COMMIT_WINDOW + 1);

    const salt = createHash('sha256').update(Buffer.from('late-salt')).digest();
    const commitHash = computeCommitHash(1, salt);
    const [voteKey] = disputeVotePda(caseId1, arbOp.publicKey, 1);

    let err: unknown;
    try {
      await program.methods
        .commitVote(commitHash)
        .accountsPartial({
          config: configKeyFresh,
          disputeCase: caseKey1,
          arbitrator: arbitratorPda(arbOp.publicKey)[0],
          voteRecord: voteKey,
          operator: arbOp.publicKey,
          arbitratorSigner: arbOp.publicKey,
        })
        .signers([arbOp])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/CommitWindowClosed/);
  });

  // ---------- 11. reveal_vote hash mismatch ----------
  it('11. reveal_vote hash mismatch — CommitHashMismatch', async () => {
    const [configKey] = disputeConfigPda();
    const configData = await program.account.disputeConfig.fetch(configKey);
    const caseId2 = configData.nextCaseId.toNumber();
    const [caseKey2] = disputeCasePda(caseId2);
    const [poolKey] = disputePoolPda();

    await program.methods
      .raiseDispute(
        new BN(200),
        client.publicKey,
        agentOperator.publicKey,
        new BN(75_000),
        paymentMint.publicKey,
      )
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey2,
        pool: poolKey,
        payer: authority.publicKey,
      })
      .rpc();

    const vrfResult3 = Array.from(
      createHash('sha256').update(Buffer.from('test-vrf-seed-3')).digest(),
    );
    await program.methods
      .consumeVrf(vrfResult3)
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey2,
        pool: poolKey,
        authority: authority.publicKey,
      })
      .rpc();

    const dc2 = await program.account.disputeCase.fetch(caseKey2);
    const arbPk = dc2.arbitrators[0]!;
    const arbOp = operators.find((o) => o.publicKey.equals(arbPk))!;

    const salt = createHash('sha256').update(Buffer.from('correct-salt')).digest();
    const commitHash = computeCommitHash(1, salt);
    const [voteKey] = disputeVotePda(caseId2, arbOp.publicKey, 1);

    await program.methods
      .commitVote(commitHash)
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey2,
        arbitrator: arbitratorPda(arbOp.publicKey)[0],
        voteRecord: voteKey,
        operator: arbOp.publicKey,
        arbitratorSigner: arbOp.publicKey,
      })
      .signers([arbOp])
      .rpc();

    await warpClockBy(context, COMMIT_WINDOW + 1);

    const wrongSalt = createHash('sha256').update(Buffer.from('wrong-salt')).digest();

    let err: unknown;
    try {
      await program.methods
        .revealVote({ agentWins: {} }, Array.from(wrongSalt))
        .accountsPartial({
          config: configKey,
          disputeCase: caseKey2,
          arbitrator: arbitratorPda(arbOp.publicKey)[0],
          voteRecord: voteKey,
          arbitratorSigner: arbOp.publicKey,
        })
        .signers([arbOp])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/CommitHashMismatch/);
  });

  // ---------- 12. resolve_dispute ----------
  it('12. resolve_dispute — after appeal window, Resolved status', async () => {
    // case 0 was appealed, which means consume_vrf round 2 must happen, then full vote cycle again.
    // Use a separate case that is Tallied (round 1) with no appeal to test resolve_dispute cleanly.
    // Raise case #3 and run it through the full cycle to Tallied without appeal.

    const [configKey] = disputeConfigPda();
    const configData = await program.account.disputeConfig.fetch(configKey);
    const caseId3 = configData.nextCaseId.toNumber();
    const [caseKey3] = disputeCasePda(caseId3);
    const [poolKey] = disputePoolPda();

    await program.methods
      .raiseDispute(
        new BN(300),
        client.publicKey,
        agentOperator.publicKey,
        new BN(60_000),
        paymentMint.publicKey,
      )
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey3,
        pool: poolKey,
        payer: authority.publicKey,
      })
      .rpc();

    const vrfResult4 = Array.from(
      createHash('sha256').update(Buffer.from('resolve-vrf')).digest(),
    );
    await program.methods
      .consumeVrf(vrfResult4)
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey3,
        pool: poolKey,
        authority: authority.publicKey,
      })
      .rpc();

    const dc3 = await program.account.disputeCase.fetch(caseKey3);
    const arbs3 = dc3.arbitrators;

    // all vote AgentWins for a clean majority
    const salts3: Uint8Array[] = [];
    for (let i = 0; i < arbs3.length; i++) {
      const arbOp = operators.find((o) => o.publicKey.equals(arbs3[i]!))!;
      const salt = createHash('sha256').update(Buffer.from(`resolve-salt-${i}`)).digest();
      salts3.push(salt);
      const commitHash = computeCommitHash(1, salt);
      const [voteKey] = disputeVotePda(caseId3, arbOp.publicKey, 1);

      await program.methods
        .commitVote(commitHash)
        .accountsPartial({
          config: configKey,
          disputeCase: caseKey3,
          arbitrator: arbitratorPda(arbOp.publicKey)[0],
          voteRecord: voteKey,
          operator: arbOp.publicKey,
          arbitratorSigner: arbOp.publicKey,
        })
        .signers([arbOp])
        .rpc();
    }

    await warpClockBy(context, COMMIT_WINDOW + 1);

    for (let i = 0; i < arbs3.length; i++) {
      const arbOp = operators.find((o) => o.publicKey.equals(arbs3[i]!))!;
      const [voteKey] = disputeVotePda(caseId3, arbOp.publicKey, 1);

      await program.methods
        .revealVote({ agentWins: {} }, Array.from(salts3[i]!))
        .accountsPartial({
          config: configKey,
          disputeCase: caseKey3,
          arbitrator: arbitratorPda(arbOp.publicKey)[0],
          voteRecord: voteKey,
          arbitratorSigner: arbOp.publicKey,
        })
        .signers([arbOp])
        .rpc();
    }

    await warpClockBy(context, REVEAL_WINDOW + 1);

    await program.methods
      .tallyRound()
      .accountsPartial({
        disputeCase: caseKey3,
        cranker: authority.publicKey,
      })
      .rpc();

    const tallied = await program.account.disputeCase.fetch(caseKey3);
    expect(Object.keys(tallied.status)[0]).to.equal('tallied');

    // warp past appeal window
    await warpClockBy(context, APPEAL_WINDOW + 1);

    await program.methods
      .resolveDispute()
      .accountsPartial({
        config: configKey,
        disputeCase: caseKey3,
        cranker: authority.publicKey,
      })
      .rpc();

    const resolved = await program.account.disputeCase.fetch(caseKey3);
    expect(Object.keys(resolved.status)[0]).to.equal('resolved');
    expect(resolved.resolvedAt.toNumber()).to.be.greaterThan(0);
  });
});
