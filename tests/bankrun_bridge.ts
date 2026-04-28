import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock } from './helpers/bankrun';
import { sendTx, createToken2022Mint, createATA, mintTokens, getTokenBalance } from './helpers/token';
import { PROGRAM_IDS, feeCollectorPdas } from './helpers/accounts';
import {
  Keypair, PublicKey, SystemProgram, Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  getAccountLen,
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { FeeCollector } from '../target/types/fee_collector';

const T0 = 1_700_000_000n;
const DECIMALS = 6;
const MINT_AMOUNT = 50_000_000;
const DEPOSIT_AMOUNT = 10_000_000;

describe('bankrun: fee_collector — SPL↔T22 bridge (deposit_saep / withdraw_saep)', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let feeProgram: anchor.Program<FeeCollector>;

  let authority: Keypair;
  const metaAuthority = Keypair.generate();
  const user = Keypair.generate();
  const externalMintAuthority = Keypair.generate();

  let externalMint: PublicKey; // SPL $SAEP (standard token program)
  let internalMint: PublicKey; // T22 protocol mint
  let userExternalAta: PublicKey;
  let userInternalAta: PublicKey;
  let depositVaultPda: PublicKey;
  let mintAuthorityPda: PublicKey;
  let configPda: PublicKey;

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const idl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/fee_collector.json'), 'utf8'));
    feeProgram = new anchor.Program<FeeCollector>(idl, provider);

    for (const kp of [metaAuthority, user, externalMintAuthority]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    [mintAuthorityPda] = feeCollectorPdas.mintAuthority();
    [depositVaultPda] = feeCollectorPdas.depositVault();

    // Create external SPL $SAEP mint (standard token program, like pump.fun)
    const extMintKp = Keypair.generate();
    const extSpace = getMintLen([]);
    const rent = await context.banksClient.getRent();
    const extTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: extMintKp.publicKey,
        space: extSpace,
        lamports: Number(rent.minimumBalance(BigInt(extSpace))),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        extMintKp.publicKey, DECIMALS,
        externalMintAuthority.publicKey, null,
        TOKEN_PROGRAM_ID,
      ),
    );
    await sendTx(context, extTx, [authority, extMintKp]);
    externalMint = extMintKp.publicKey;

    // Create internal T22 mint with mint authority = protocol PDA
    const intMintKp = Keypair.generate();
    const [feeAuth] = feeCollectorPdas.transferFeeWithdrawAuthority();
    const intExtensions = [ExtensionType.TransferFeeConfig];
    const intSpace = getMintLen(intExtensions);
    const intTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: intMintKp.publicKey,
        space: intSpace,
        lamports: Number(rent.minimumBalance(BigInt(intSpace))),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        intMintKp.publicKey, feeAuth, feeAuth,
        100, BigInt(1_000_000_000),
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMint2Instruction(
        intMintKp.publicKey, DECIMALS,
        mintAuthorityPda, // mint authority = fee_collector PDA
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, intTx, [authority, intMintKp]);
    internalMint = intMintKp.publicKey;

    // User's external ATA (standard SPL)
    const userExtAta = getAssociatedTokenAddressSync(
      externalMint, user.publicKey, false, TOKEN_PROGRAM_ID,
    );
    const createExtAta = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, userExtAta, user.publicKey,
        externalMint, TOKEN_PROGRAM_ID,
      ),
    );
    await sendTx(context, createExtAta, [authority]);
    userExternalAta = userExtAta;

    // Mint external tokens to user
    const mintExtTx = new Transaction().add(
      createMintToInstruction(
        externalMint, userExternalAta,
        externalMintAuthority.publicKey, MINT_AMOUNT, [],
        TOKEN_PROGRAM_ID,
      ),
    );
    await sendTx(context, mintExtTx, [authority, externalMintAuthority]);

    // User's internal ATA (T22)
    const userIntAta = getAssociatedTokenAddressSync(
      internalMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID,
    );
    const createIntAta = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, userIntAta, user.publicKey,
        internalMint, TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, createIntAta, [authority]);
    userInternalAta = userIntAta;

    // Inject deposit vault PDA (SPL token account at PDA address)
    const vaultSpace = getAccountLen([]);
    const vaultData = Buffer.alloc(vaultSpace, 0);
    externalMint.toBuffer().copy(vaultData, 0);     // mint
    depositVaultPda.toBuffer().copy(vaultData, 32);  // owner = self (PDA)
    vaultData.writeUInt8(1, 108);                    // state = Initialized

    context.setAccount(depositVaultPda, {
      lamports: Number(rent.minimumBalance(BigInt(vaultSpace))),
      data: vaultData,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
    });

    // Init fee_collector config
    await feeProgram.methods
      .initConfig({
        authority: authority.publicKey,
        metaAuthority: metaAuthority.publicKey,
        governanceProgram: PublicKey.default,
        nxsStaking: PublicKey.default,
        agentRegistry: PROGRAM_IDS.agent_registry,
        disputeArbitration: PublicKey.default,
        emergencyCouncil: authority.publicKey,
        saepMint: internalMint,
        externalSaepMint: externalMint,
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
  });

  it('config stores both external and internal mint', async () => {
    const config = await feeProgram.account.feeCollectorConfig.fetch(configPda);
    expect(config.saepMint.toBase58()).to.equal(internalMint.toBase58());
    expect(config.externalSaepMint.toBase58()).to.equal(externalMint.toBase58());
  });

  it('deposit_saep transfers SPL → vault and mints T22 1:1', async () => {
    const extBefore = await getTokenBalance(context, userExternalAta);
    const intBefore = await getTokenBalance(context, userInternalAta);

    await feeProgram.methods
      .depositSaep(new BN(DEPOSIT_AMOUNT))
      .accountsPartial({
        config: configPda,
        externalMint,
        internalMint,
        depositorExternal: userExternalAta,
        depositorInternal: userInternalAta,
        depositVault: depositVaultPda,
        mintAuthority: mintAuthorityPda,
        depositor: user.publicKey,
        externalTokenProgram: TOKEN_PROGRAM_ID,
        internalTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const extAfter = await getTokenBalance(context, userExternalAta);
    const intAfter = await getTokenBalance(context, userInternalAta);
    const vaultAfter = await getTokenBalance(context, depositVaultPda);

    expect(Number(extBefore - extAfter)).to.equal(DEPOSIT_AMOUNT);
    expect(Number(intAfter - intBefore)).to.equal(DEPOSIT_AMOUNT);
    expect(Number(vaultAfter)).to.equal(DEPOSIT_AMOUNT);
  });

  it('deposit_saep rejects zero amount', async () => {
    try {
      await feeProgram.methods
        .depositSaep(new BN(0))
        .accountsPartial({
          config: configPda,
          externalMint,
          internalMint,
          depositorExternal: userExternalAta,
          depositorInternal: userInternalAta,
          depositVault: depositVaultPda,
          mintAuthority: mintAuthorityPda,
          depositor: user.publicKey,
          externalTokenProgram: TOKEN_PROGRAM_ID,
          internalTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.toString()).to.include('ZeroDeposit');
    }
  });

  it('withdraw_saep burns T22 and returns SPL 1:1', async () => {
    const withdrawAmount = 5_000_000;
    const extBefore = await getTokenBalance(context, userExternalAta);
    const intBefore = await getTokenBalance(context, userInternalAta);

    await feeProgram.methods
      .withdrawSaep(new BN(withdrawAmount))
      .accountsPartial({
        config: configPda,
        externalMint,
        internalMint,
        withdrawerInternal: userInternalAta,
        withdrawerExternal: userExternalAta,
        depositVault: depositVaultPda,
        mintAuthority: mintAuthorityPda,
        withdrawer: user.publicKey,
        externalTokenProgram: TOKEN_PROGRAM_ID,
        internalTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const extAfter = await getTokenBalance(context, userExternalAta);
    const intAfter = await getTokenBalance(context, userInternalAta);

    expect(Number(extAfter - extBefore)).to.equal(withdrawAmount);
    expect(Number(intBefore - intAfter)).to.equal(withdrawAmount);
  });

  it('withdraw_saep rejects insufficient balance', async () => {
    const tooMuch = MINT_AMOUNT * 10;
    try {
      await feeProgram.methods
        .withdrawSaep(new BN(tooMuch))
        .accountsPartial({
          config: configPda,
          externalMint,
          internalMint,
          withdrawerInternal: userInternalAta,
          withdrawerExternal: userExternalAta,
          depositVault: depositVaultPda,
          mintAuthority: mintAuthorityPda,
          withdrawer: user.publicKey,
          externalTokenProgram: TOKEN_PROGRAM_ID,
          internalTokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.toString()).to.include('InsufficientBalance');
    }
  });
});
