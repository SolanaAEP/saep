import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock } from './helpers/bankrun';
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
  getAccountLen,
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferCheckedWithFeeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { FeeCollector } from '../target/types/fee_collector';

const T0 = 1_700_000_000n;
const DECIMALS = 6;
const FEE_BPS = 100;
const MAX_FEE = 1_000_000_000;
const MINT_AMOUNT = 100_000_000;
const TRANSFER_AMOUNT = 10_000_000;

describe('bankrun: fee_collector — harvest_transfer_fees + harvest_confidential_fees', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let feeProgram: anchor.Program<FeeCollector>;

  let authority: Keypair;
  const metaAuthority = Keypair.generate();
  const mintAuthority = Keypair.generate();
  const cranker = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();

  let mint: PublicKey;
  let aliceAta: PublicKey;
  let bobAta: PublicKey;

  let configPda: PublicKey;
  let epochPda: PublicKey;
  let vaultPda: PublicKey;

  function harvestAccounts() {
    const [feeAuth] = feeCollectorPdas.transferFeeWithdrawAuthority();
    return {
      config: configPda,
      currentEpoch: epochPda,
      saepMint: mint,
      intakeVault: vaultPda,
      feeWithdrawAuthority: feeAuth,
      cranker: cranker.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    };
  }

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const idl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/fee_collector.json'), 'utf8'));
    feeProgram = new anchor.Program<FeeCollector>(idl, provider);

    for (const kp of [metaAuthority, mintAuthority, cranker, alice, bob]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    // Create Token-2022 mint with TransferFee extension.
    // Withdraw authority = fee_collector PDA so harvest can CPI withdraw.
    const mintKeypair = Keypair.generate();
    const [feeAuth] = feeCollectorPdas.transferFeeWithdrawAuthority();

    const mintExtensions = [ExtensionType.TransferFeeConfig];
    const mintSpace = getMintLen(mintExtensions);
    const rent = await context.banksClient.getRent();

    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintSpace,
        lamports: Number(rent.minimumBalance(BigInt(mintSpace))),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey,
        feeAuth,
        feeAuth,
        FEE_BPS,
        BigInt(MAX_FEE),
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMint2Instruction(
        mintKeypair.publicKey,
        DECIMALS,
        mintAuthority.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, createMintTx, [authority, mintKeypair]);
    mint = mintKeypair.publicKey;

    // ATAs for alice + bob
    const createAtaFor = async (owner: PublicKey): Promise<PublicKey> => {
      const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID,
        ),
      );
      await sendTx(context, tx, [authority]);
      return ata;
    };
    aliceAta = await createAtaFor(alice.publicKey);
    bobAta = await createAtaFor(bob.publicKey);

    // Mint tokens to alice
    const mintTx = new Transaction().add(
      createMintToInstruction(
        mint, aliceAta, mintAuthority.publicKey, MINT_AMOUNT, [], TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, mintTx, [authority, mintAuthority]);

    // Transfer alice→bob to accumulate withheld fees (1% of 10M = 100K)
    const fee = BigInt(TRANSFER_AMOUNT) * BigInt(FEE_BPS) / 10_000n;
    const xferTx = new Transaction().add(
      createTransferCheckedWithFeeInstruction(
        aliceAta, mint, bobAta, alice.publicKey,
        BigInt(TRANSFER_AMOUNT), DECIMALS, fee, [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, xferTx, [authority, alice]);

    // Inject intake_vault as a PDA token account.
    // Anchor checks `seeds = [b"intake_vault"]` so the address must be the PDA.
    [vaultPda] = feeCollectorPdas.intakeVault();
    const acctExtensions = [ExtensionType.TransferFeeAmount];
    const acctSpace = getAccountLen(acctExtensions);
    const acctLamports = Number(rent.minimumBalance(BigInt(acctSpace)));

    const acctData = Buffer.alloc(acctSpace, 0);
    mint.toBuffer().copy(acctData, 0);        // mint
    vaultPda.toBuffer().copy(acctData, 32);   // owner = self (PDA)
    // amount = 0 at offset 64
    acctData.writeUInt8(1, 108);              // state = Initialized
    if (acctSpace > 165) {
      acctData.writeUInt8(2, 165);            // AccountType::Account
    }

    context.setAccount(vaultPda, {
      lamports: acctLamports,
      data: acctData,
      owner: TOKEN_2022_PROGRAM_ID,
      executable: false,
    });

    // Init fee_collector config (creates config PDA + epoch 0 PDA)
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
        grantRecipient: PublicKey.default,
        treasuryRecipient: PublicKey.default,
        burnBps: 1000,
        stakerShareBps: 5000,
        grantShareBps: 2000,
        treasuryShareBps: 2000,
        epochDurationSecs: new BN(7 * 86_400),
        claimWindowSecs: new BN(90 * 86_400),
        minEpochTotalForBurn: new BN(0),
      })
      .accountsPartial({ deployer: authority.publicKey })
      .rpc();

    [configPda] = feeCollectorPdas.config();
    [epochPda] = feeCollectorPdas.epoch(0);
  });

  it('init_config created config + epoch 0', async () => {
    const config = await feeProgram.account.feeCollectorConfig.fetch(configPda);
    expect(config.saepMint.toBase58()).to.equal(mint.toBase58());
    expect(config.paused).to.equal(false);
    expect(config.confidentialTransfersEnabled).to.equal(false);
    expect(config.nextEpochId.toNumber()).to.equal(1);

    const epoch = await feeProgram.account.epochAccount.fetch(epochPda);
    expect(epoch.epochId.toNumber()).to.equal(0);
    expect(JSON.stringify(epoch.status)).to.include('open');
  });

  it('harvest_transfer_fees collects withheld fees into intake vault', async () => {
    const vaultBefore = await getTokenBalance(context, vaultPda);
    expect(Number(vaultBefore)).to.equal(0);

    await feeProgram.methods
      .harvestTransferFees()
      .accountsPartial(harvestAccounts())
      .remainingAccounts([
        { pubkey: bobAta, isSigner: false, isWritable: true },
      ])
      .signers([cranker])
      .rpc();

    const vaultAfter = await getTokenBalance(context, vaultPda);
    const expectedFee = BigInt(TRANSFER_AMOUNT) * BigInt(FEE_BPS) / 10_000n;
    expect(Number(vaultAfter)).to.equal(Number(expectedFee));

    const epoch = await feeProgram.account.epochAccount.fetch(epochPda);
    expect(epoch.totalCollected.toNumber()).to.equal(Number(expectedFee));
  });

  it('harvest_transfer_fees rejects empty remaining_accounts', async () => {
    try {
      await feeProgram.methods
        .harvestTransferFees()
        .accountsPartial(harvestAccounts())
        .remainingAccounts([])
        .signers([cranker])
        .rpc();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.toString()).to.include('InvalidEpochStatus');
    }
  });

  it('harvest_transfer_fees rejects when paused', async () => {
    await feeProgram.methods
      .setPaused(true)
      .accountsPartial({ authority: authority.publicKey })
      .rpc();

    try {
      await feeProgram.methods
        .harvestTransferFees()
        .accountsPartial(harvestAccounts())
        .remainingAccounts([
          { pubkey: bobAta, isSigner: false, isWritable: true },
        ])
        .signers([cranker])
        .rpc();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.toString()).to.include('Paused');
    }

    await feeProgram.methods
      .setPaused(false)
      .accountsPartial({ authority: authority.publicKey })
      .rpc();
  });

  it('harvest_confidential_fees rejects when confidential_transfers_enabled=false', async () => {
    try {
      await feeProgram.methods
        .harvestConfidentialFees()
        .accountsPartial(harvestAccounts())
        .remainingAccounts([
          { pubkey: bobAta, isSigner: false, isWritable: true },
        ])
        .signers([cranker])
        .rpc();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.toString()).to.include('ConfidentialTransfersDisabled');
    }
  });

  it('set_confidential_transfers requires meta_authority', async () => {
    try {
      await feeProgram.methods
        .setConfidentialTransfers(true)
        .accountsPartial({ authority: authority.publicKey })
        .rpc();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.toString()).to.include('Unauthorized');
    }
  });

  it('set_confidential_transfers succeeds with meta_authority', async () => {
    await feeProgram.methods
      .setConfidentialTransfers(true)
      .accountsPartial({ authority: metaAuthority.publicKey })
      .signers([metaAuthority])
      .rpc();

    const config = await feeProgram.account.feeCollectorConfig.fetch(configPda);
    expect(config.confidentialTransfersEnabled).to.equal(true);
  });

  it('harvest_confidential_fees passes gate once enabled (fails at token program — no CT extension)', async () => {
    try {
      await feeProgram.methods
        .harvestConfidentialFees()
        .accountsPartial(harvestAccounts())
        .remainingAccounts([
          { pubkey: bobAta, isSigner: false, isWritable: true },
        ])
        .signers([cranker])
        .rpc();
    } catch (e: any) {
      // Gate passed — error comes from token program, not our program
      expect(e.toString()).not.to.include('ConfidentialTransfersDisabled');
    }
  });
});
