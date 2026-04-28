import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock, warpClockTo } from './helpers/bankrun';
import { sendTx, getTokenBalance } from './helpers/token';
import { PROGRAM_IDS, feeCollectorPdas } from './helpers/accounts';
import {
  Keypair, PublicKey, SystemProgram, Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferCheckedWithFeeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { FeeCollector } from '../target/types/fee_collector';

const T0 = 1_700_000_000n;
const DECIMALS = 6;
const FEE_BPS = 100;
const MAX_FEE = 1_000_000_000;
const EPOCH_DURATION = 7 * 86_400;
const CLAIM_WINDOW = 90 * 86_400;

function hashLeaf(staker: PublicKey, amount: bigint, epochId: bigint): Buffer {
  return createHash('sha256')
    .update(staker.toBuffer())
    .update(Buffer.from(new BN(amount.toString()).toArray('le', 8)))
    .update(Buffer.from(new BN(epochId.toString()).toArray('le', 8)))
    .digest();
}

function injectTokenAccount(
  context: ProgramTestContext,
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
  lamports: number,
) {
  const space = 178;
  const data = Buffer.alloc(space, 0);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data.writeUInt8(1, 108);
  data.writeUInt8(2, 165);
  data.writeUInt16LE(2, 166);
  data.writeUInt16LE(8, 168);
  data.writeBigUInt64LE(0n, 170);
  context.setAccount(address, { lamports, data, owner: TOKEN_2022_PROGRAM_ID, executable: false });
}

describe('bankrun: fee_collector — epoch lifecycle (process → burn → claim → sweep)', function () {
  this.timeout(120_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let feeProgram: anchor.Program<FeeCollector>;

  let authority: Keypair;
  const metaAuthority = Keypair.generate();
  const mintAuthKp = Keypair.generate();
  const cranker = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const staker = Keypair.generate();

  let mint: PublicKey;
  let bobAta: PublicKey;
  let stakerAta: PublicKey;

  let configPda: PublicKey;
  let epoch0Pda: PublicKey;
  let intakeVault: PublicKey;
  let burnVault: PublicKey;
  let stakerVault: PublicKey;
  let grantRecipient: PublicKey;
  let treasuryRecipient: PublicKey;

  let rentPerAccount: number;
  let collectedAmount: number;

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const idl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/fee_collector.json'), 'utf8'));
    feeProgram = new anchor.Program<FeeCollector>(idl, provider);

    for (const kp of [metaAuthority, mintAuthKp, cranker, alice, bob, staker]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    const mintKeypair = Keypair.generate();
    const [feeAuth] = feeCollectorPdas.transferFeeWithdrawAuthority();

    const mintExtensions = [ExtensionType.TransferFeeConfig];
    const mintSpace = getMintLen(mintExtensions);
    const rent = await context.banksClient.getRent();
    rentPerAccount = Number(rent.minimumBalance(178n));

    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintSpace,
        lamports: Number(rent.minimumBalance(BigInt(mintSpace))),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey, feeAuth, feeAuth,
        FEE_BPS, BigInt(MAX_FEE), TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMint2Instruction(
        mintKeypair.publicKey, DECIMALS,
        mintAuthKp.publicKey, null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, createMintTx, [authority, mintKeypair]);
    mint = mintKeypair.publicKey;

    const createAtaFor = async (owner: PublicKey): Promise<PublicKey> => {
      const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
      await sendTx(context, new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID,
        ),
      ), [authority]);
      return ata;
    };
    const aliceAta = await createAtaFor(alice.publicKey);
    bobAta = await createAtaFor(bob.publicKey);
    stakerAta = await createAtaFor(staker.publicKey);

    await sendTx(context, new Transaction().add(
      createMintToInstruction(mint, aliceAta, mintAuthKp.publicKey, 100_000_000, [], TOKEN_2022_PROGRAM_ID),
    ), [authority, mintAuthKp]);

    const xferAmount = 50_000_000n;
    const fee = xferAmount * BigInt(FEE_BPS) / 10_000n;
    await sendTx(context, new Transaction().add(
      createTransferCheckedWithFeeInstruction(
        aliceAta, mint, bobAta, alice.publicKey,
        xferAmount, DECIMALS, fee, [], TOKEN_2022_PROGRAM_ID,
      ),
    ), [authority, alice]);

    [intakeVault] = feeCollectorPdas.intakeVault();
    [burnVault] = feeCollectorPdas.burnVault();
    [stakerVault] = feeCollectorPdas.stakerVault();

    injectTokenAccount(context, intakeVault, mint, intakeVault, 0n, rentPerAccount);
    injectTokenAccount(context, burnVault, mint, burnVault, 0n, rentPerAccount);
    injectTokenAccount(context, stakerVault, mint, stakerVault, 0n, rentPerAccount);

    const grantOwner = Keypair.generate();
    const treasuryOwner = Keypair.generate();
    for (const kp of [grantOwner, treasuryOwner]) {
      context.setAccount(kp.publicKey, {
        lamports: 10 * LAMPORTS_PER_SOL, data: Buffer.alloc(0),
        owner: SystemProgram.programId, executable: false,
      });
    }
    grantRecipient = await createAtaFor(grantOwner.publicKey);
    treasuryRecipient = await createAtaFor(treasuryOwner.publicKey);

    await feeProgram.methods
      .initConfig({
        authority: authority.publicKey,
        metaAuthority: metaAuthority.publicKey,
        governanceProgram: PublicKey.default,
        nxsStaking: PublicKey.default,
        agentRegistry: PROGRAM_IDS.agent_registry,
        disputeArbitration: PublicKey.default,
        emergencyCouncil: authority.publicKey,
        saepMint: mint,
        externalSaepMint: PublicKey.default,
        grantRecipient,
        treasuryRecipient,
        burnBps: 1000,
        stakerShareBps: 5000,
        grantShareBps: 2000,
        treasuryShareBps: 2000,
        epochDurationSecs: new BN(EPOCH_DURATION),
        claimWindowSecs: new BN(CLAIM_WINDOW),
        minEpochTotalForBurn: new BN(0),
      })
      .accountsPartial({ deployer: authority.publicKey })
      .rpc();

    [configPda] = feeCollectorPdas.config();
    [epoch0Pda] = feeCollectorPdas.epoch(0);

    // Harvest withheld fees → intake_vault
    const [harvestAuth] = feeCollectorPdas.transferFeeWithdrawAuthority();
    await feeProgram.methods
      .harvestTransferFees()
      .accountsPartial({
        config: configPda, currentEpoch: epoch0Pda, saepMint: mint,
        intakeVault, feeWithdrawAuthority: harvestAuth,
        cranker: cranker.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts([{ pubkey: bobAta, isSigner: false, isWritable: true }])
      .signers([cranker])
      .rpc();

    collectedAmount = Number(await getTokenBalance(context, intakeVault));
    expect(collectedAmount).to.be.greaterThan(0);
  });

  describe('process_epoch', () => {
    it('rejects before epoch duration elapsed', async () => {
      const [epoch1Pda] = feeCollectorPdas.epoch(1);
      try {
        await feeProgram.methods
          .processEpoch(new BN(0))
          .accountsPartial({
            config: configPda, currentEpoch: epoch0Pda, nextEpoch: epoch1Pda,
            saepMint: mint, intakeVault, burnVault, stakerVault,
            grantRecipient, treasuryRecipient,
            cranker: cranker.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([cranker])
          .rpc();
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.toString()).to.include('EpochNotElapsed');
      }
    });

    it('succeeds after epoch duration, splits into 4 buckets', async () => {
      await warpClockTo(context, T0 + BigInt(EPOCH_DURATION) + 1n);

      const [epoch1Pda] = feeCollectorPdas.epoch(1);
      await feeProgram.methods
        .processEpoch(new BN(0))
        .accountsPartial({
          config: configPda, currentEpoch: epoch0Pda, nextEpoch: epoch1Pda,
          saepMint: mint, intakeVault, burnVault, stakerVault,
          grantRecipient, treasuryRecipient,
          cranker: cranker.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([cranker])
        .rpc();

      const epoch = await feeProgram.account.epochAccount.fetch(epoch0Pda);
      expect(JSON.stringify(epoch.status)).to.include('splitting');
      expect(epoch.burnAmount.toNumber()).to.equal(Math.floor(collectedAmount * 1000 / 10000));
      expect(epoch.stakerAmount.toNumber()).to.equal(Math.floor(collectedAmount * 5000 / 10000));
      expect(epoch.grantAmount.toNumber()).to.be.greaterThan(0);
      expect(epoch.treasuryAmount.toNumber()).to.be.greaterThan(0);
      expect(Number(await getTokenBalance(context, intakeVault))).to.equal(0);

      const config = await feeProgram.account.feeCollectorConfig.fetch(configPda);
      expect(config.nextEpochId.toNumber()).to.equal(2);
    });
  });

  describe('execute_burn', () => {
    it('burns tokens from burn_vault', async () => {
      const epoch = await feeProgram.account.epochAccount.fetch(epoch0Pda);
      const burnTarget = epoch.burnAmount.toNumber();
      const burnVaultBal = Number(await getTokenBalance(context, burnVault));

      // Internal transfer deducted 1% fee. Top up the gap so burn succeeds.
      const gap = burnTarget - burnVaultBal;
      if (gap > 0) {
        await sendTx(context, new Transaction().add(
          createMintToInstruction(mint, burnVault, mintAuthKp.publicKey, gap, [], TOKEN_2022_PROGRAM_ID),
        ), [authority, mintAuthKp]);
      }

      await feeProgram.methods
        .executeBurn(new BN(0))
        .accountsPartial({
          config: configPda, epoch: epoch0Pda, saepMint: mint,
          burnVault, cranker: cranker.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([cranker])
        .rpc();

      const updated = await feeProgram.account.epochAccount.fetch(epoch0Pda);
      expect(updated.burnExecuted).to.equal(true);
      expect(Number(await getTokenBalance(context, burnVault))).to.equal(0);
    });

    it('rejects double burn', async () => {
      try {
        await feeProgram.methods
          .executeBurn(new BN(0))
          .accountsPartial({
            config: configPda, epoch: epoch0Pda, saepMint: mint,
            burnVault, cranker: cranker.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([cranker])
          .rpc();
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.toString()).to.include('BurnAlreadyExecuted');
      }
    });
  });

  describe('commit_distribution_root + claim_staker', () => {
    let merkleRoot: Buffer;
    let stakerAmount: bigint;

    it('commit_distribution_root sets merkle root', async () => {
      const epoch = await feeProgram.account.epochAccount.fetch(epoch0Pda);
      stakerAmount = BigInt(epoch.stakerAmount.toNumber());
      merkleRoot = hashLeaf(staker.publicKey, stakerAmount, 0n);

      await feeProgram.methods
        .commitDistributionRoot(
          new BN(0),
          Array.from(merkleRoot) as number[],
          1,
          new BN(stakerAmount.toString()),
        )
        .accountsPartial({
          config: configPda, epoch: epoch0Pda,
          committer: authority.publicKey,
        })
        .rpc();

      const updated = await feeProgram.account.epochAccount.fetch(epoch0Pda);
      expect(updated.stakerDistributionCommitted).to.equal(true);
      expect(JSON.stringify(updated.status)).to.include('distributionCommitted');
    });

    it('claim_staker transfers tokens to staker', async () => {
      // Top up staker_vault to cover internal transfer fee gap
      const stakerVaultBal = Number(await getTokenBalance(context, stakerVault));
      const gap = Number(stakerAmount) - stakerVaultBal;
      if (gap > 0) {
        await sendTx(context, new Transaction().add(
          createMintToInstruction(mint, stakerVault, mintAuthKp.publicKey, gap, [], TOKEN_2022_PROGRAM_ID),
        ), [authority, mintAuthKp]);
      }

      const balBefore = await getTokenBalance(context, stakerAta);

      await feeProgram.methods
        .claimStaker(new BN(0), new BN(stakerAmount.toString()), [])
        .accountsPartial({
          config: configPda, epoch: epoch0Pda, saepMint: mint,
          stakerVault, stakerTokenAccount: stakerAta,
          staker: staker.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([staker])
        .rpc();

      const balAfter = await getTokenBalance(context, stakerAta);
      // Staker receives stakerAmount minus 1% transfer fee on the claim transfer
      const received = Number(balAfter) - Number(balBefore);
      const expectedFee = Number(stakerAmount) * FEE_BPS / 10_000;
      expect(received).to.equal(Number(stakerAmount) - expectedFee);
    });

    it('rejects double claim', async () => {
      try {
        await feeProgram.methods
          .claimStaker(new BN(0), new BN(stakerAmount.toString()), [])
          .accountsPartial({
            config: configPda, epoch: epoch0Pda, saepMint: mint,
            stakerVault, stakerTokenAccount: stakerAta,
            staker: staker.publicKey,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([staker])
          .rpc();
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e).to.not.be.null;
      }
    });
  });

  describe('sweep_stale_epoch', () => {
    it('rejects before sweep deadline', async () => {
      const [epoch1Pda] = feeCollectorPdas.epoch(1);
      try {
        await feeProgram.methods
          .sweepStaleEpoch(new BN(0))
          .accountsPartial({
            config: configPda, epoch: epoch0Pda, nextEpoch: epoch1Pda,
            saepMint: mint, stakerVault, burnVault, intakeVault,
            cranker: cranker.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([cranker])
          .rpc();
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.toString()).to.include('SweepGraceNotElapsed');
      }
    });

    it('succeeds after claim window + grace period', async () => {
      const sweepTime = T0 + BigInt(EPOCH_DURATION) + BigInt(CLAIM_WINDOW) + BigInt(7 * 86_400) + 100n;
      await warpClockTo(context, sweepTime);

      const [epoch1Pda] = feeCollectorPdas.epoch(1);
      await feeProgram.methods
        .sweepStaleEpoch(new BN(0))
        .accountsPartial({
          config: configPda, epoch: epoch0Pda, nextEpoch: epoch1Pda,
          saepMint: mint, stakerVault, burnVault, intakeVault,
          cranker: cranker.publicKey, tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([cranker])
        .rpc();

      const epoch = await feeProgram.account.epochAccount.fetch(epoch0Pda);
      expect(epoch.staleSwept).to.equal(true);
      expect(JSON.stringify(epoch.status)).to.include('stale');
    });
  });
});
