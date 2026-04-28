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

import {
  buildConfigureConfidentialAccountIx,
  buildApplyPendingBalanceIx,
  getConfidentialTokenAddress,
} from '../packages/sdk/src/confidential';

const T0 = 1_700_000_000n;
const DECIMALS = 6;
const FEE_BPS = 100;
const MAX_FEE = 1_000_000_000;

const CONFIDENTIAL_TRANSFER_DISCRIMINATOR = 27;
const CT_CONFIGURE_ACCOUNT = 1;
const CT_APPLY_PENDING_BALANCE = 8;

describe('bankrun: confidential transfer — SDK builders + CT mint setup', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let feeProgram: anchor.Program<FeeCollector>;

  let authority: Keypair;
  const metaAuthority = Keypair.generate();
  const mintAuthKp = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();

  let mint: PublicKey;
  let aliceAta: PublicKey;
  let bobAta: PublicKey;
  let configPda: PublicKey;

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const idl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/fee_collector.json'), 'utf8'));
    feeProgram = new anchor.Program<FeeCollector>(idl, provider);

    for (const kp of [metaAuthority, mintAuthKp, alice, bob]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    const [feeAuth] = feeCollectorPdas.transferFeeWithdrawAuthority();
    const mintKeypair = Keypair.generate();

    // T22 mint with TransferFee + ConfidentialTransferMint + ConfidentialTransferFeeConfig
    // ConfidentialTransfer extensions require specific init order:
    // 1. createAccount  2. initTransferFee  3. initConfidentialTransferMint
    // 4. initConfidentialTransferFeeConfig  5. initMint
    //
    // bankrun doesn't have ZK ElGamal proof program, so CT instructions
    // that need proofs will fail at token-program level — which is fine.
    // We test everything up to the proof boundary.
    const mintExtensions = [
      ExtensionType.TransferFeeConfig,
      ExtensionType.ConfidentialTransferMint,
    ];
    // ConfidentialTransferFeeConfig (ext type 16) not in @solana/spl-token enum.
    // getMintLen doesn't know its size, so add 97 bytes (the on-chain struct size).
    const mintSpace = getMintLen(mintExtensions) + 1 + 2 + 97;
    const rent = await context.banksClient.getRent();

    // Build ConfidentialTransferMint init instruction manually
    // discriminator=27, sub-instruction=0 (InitializeMint)
    // authority: Option<Pubkey> (1 + 32), auto_approve: bool, auditor_elgamal_pubkey: Option<[u8;32]> (1 + 32)
    const ctMintInitData = Buffer.alloc(1 + 1 + 1 + 32 + 1 + 1 + 32);
    let off = 0;
    ctMintInitData.writeUInt8(CONFIDENTIAL_TRANSFER_DISCRIMINATOR, off); off += 1;
    ctMintInitData.writeUInt8(0, off); off += 1; // InitializeMint
    ctMintInitData.writeUInt8(1, off); off += 1; // Some(authority)
    authority.publicKey.toBuffer().copy(ctMintInitData, off); off += 32;
    ctMintInitData.writeUInt8(1, off); off += 1; // auto_approve_new_accounts = true
    ctMintInitData.writeUInt8(1, off); off += 1; // Some(auditor key)
    // 32-byte zero auditor key (placeholder — real deployment uses ceremony key)
    off += 32;

    const ctMintInitIx = new anchor.web3.TransactionInstruction({
      keys: [{ pubkey: mintKeypair.publicKey, isSigner: false, isWritable: true }],
      programId: TOKEN_2022_PROGRAM_ID,
      data: ctMintInitData,
    });

    // ConfidentialTransferFeeConfig init — discriminator 37, sub 0
    // authority: Option<Pubkey>, withdraw_withheld_authority_elgamal_pubkey: [u8;32]
    const ctFeeInitData = Buffer.alloc(1 + 1 + 1 + 32 + 32);
    off = 0;
    ctFeeInitData.writeUInt8(37, off); off += 1; // ConfidentialTransferFee discriminator
    ctFeeInitData.writeUInt8(0, off); off += 1;  // InitializeConfidentialTransferFeeConfig
    ctFeeInitData.writeUInt8(1, off); off += 1;  // Some(authority)
    feeAuth.toBuffer().copy(ctFeeInitData, off); off += 32;
    // 32-byte zero withdraw_withheld_authority_elgamal_pubkey (placeholder)

    const ctFeeInitIx = new anchor.web3.TransactionInstruction({
      keys: [{ pubkey: mintKeypair.publicKey, isSigner: false, isWritable: true }],
      programId: TOKEN_2022_PROGRAM_ID,
      data: ctFeeInitData,
    });

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
      ctMintInitIx,
      ctFeeInitIx,
      createInitializeMint2Instruction(
        mintKeypair.publicKey, DECIMALS,
        mintAuthKp.publicKey, null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, createMintTx, [authority, mintKeypair]);
    mint = mintKeypair.publicKey;

    // Create ATAs
    const createAtaFor = async (owner: PublicKey): Promise<PublicKey> => {
      const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
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
        mint, aliceAta, mintAuthKp.publicKey, 100_000_000, [], TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendTx(context, mintTx, [authority, mintAuthKp]);

    // Init fee_collector config
    // Inject intake_vault PDA
    const [vaultPda] = feeCollectorPdas.intakeVault();
    const acctExtensions = [ExtensionType.TransferFeeAmount];
    const acctSpace = getAccountLen(acctExtensions);
    const acctData = Buffer.alloc(acctSpace, 0);
    mint.toBuffer().copy(acctData, 0);
    vaultPda.toBuffer().copy(acctData, 32);
    acctData.writeUInt8(1, 108);
    if (acctSpace > 165) acctData.writeUInt8(2, 165);
    context.setAccount(vaultPda, {
      lamports: Number(rent.minimumBalance(BigInt(acctSpace))),
      data: acctData,
      owner: TOKEN_2022_PROGRAM_ID,
      executable: false,
    });

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

  describe('CT mint initialization', () => {
    it('mint created with ConfidentialTransfer + ConfidentialTransferFee extensions', async () => {
      const mintAcct = await context.banksClient.getAccount(mint);
      expect(mintAcct).to.not.be.null;
      expect(mintAcct!.owner.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
      // Mint space includes CT extensions — should be larger than plain TransferFee mint
      const plainSpace = getMintLen([ExtensionType.TransferFeeConfig]);
      expect(mintAcct!.data.length).to.be.greaterThan(plainSpace);
    });

    it('plaintext transfers still work on CT-enabled mint', async () => {
      const fee = 10_000_000n * BigInt(FEE_BPS) / 10_000n;
      const tx = new Transaction().add(
        createTransferCheckedWithFeeInstruction(
          aliceAta, mint, bobAta, alice.publicKey,
          10_000_000n, DECIMALS, fee, [],
          TOKEN_2022_PROGRAM_ID,
        ),
      );
      await sendTx(context, tx, [authority, alice]);

      const bobBal = await getTokenBalance(context, bobAta);
      expect(Number(bobBal)).to.equal(10_000_000 - Number(fee));
    });
  });

  describe('SDK instruction builders', () => {
    it('getConfidentialTokenAddress matches getAssociatedTokenAddressSync', () => {
      const expected = getAssociatedTokenAddressSync(
        mint, alice.publicKey, false, TOKEN_2022_PROGRAM_ID,
      );
      const actual = getConfidentialTokenAddress(mint, alice.publicKey);
      expect(actual.toBase58()).to.equal(expected.toBase58());
    });

    it('buildConfigureConfidentialAccountIx produces valid instruction data', () => {
      const zeroBalance = new Uint8Array(36);
      const maxCounter = 65536n;
      const proofOffset = 0;

      const ix = buildConfigureConfidentialAccountIx(
        aliceAta, mint, alice.publicKey,
        zeroBalance, maxCounter, proofOffset,
      );

      expect(ix.programId.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
      expect(ix.keys).to.have.length(3);
      expect(ix.keys[0]!.pubkey.toBase58()).to.equal(aliceAta.toBase58());
      expect(ix.keys[0]!.isWritable).to.equal(true);
      expect(ix.keys[1]!.pubkey.toBase58()).to.equal(mint.toBase58());
      expect(ix.keys[1]!.isWritable).to.equal(false);
      expect(ix.keys[2]!.pubkey.toBase58()).to.equal(alice.publicKey.toBase58());
      expect(ix.keys[2]!.isSigner).to.equal(true);

      // Verify data layout: discriminator(1) + sub(1) + zeroBalance(36) + counter(8) + offset(1) = 47
      expect(ix.data.length).to.equal(47);
      expect(ix.data[0]).to.equal(CONFIDENTIAL_TRANSFER_DISCRIMINATOR);
      expect(ix.data[1]).to.equal(CT_CONFIGURE_ACCOUNT);
    });

    it('buildConfigureConfidentialAccountIx rejects wrong-sized decryptable balance', () => {
      expect(() =>
        buildConfigureConfidentialAccountIx(
          aliceAta, mint, alice.publicKey,
          new Uint8Array(32), 65536n, 0,
        ),
      ).to.throw('decryptableZeroBalance must be 36 bytes');
    });

    it('buildApplyPendingBalanceIx produces valid instruction data', () => {
      const newBalance = new Uint8Array(36);
      const counter = 1n;

      const ix = buildApplyPendingBalanceIx(
        aliceAta, alice.publicKey, counter, newBalance,
      );

      expect(ix.programId.toBase58()).to.equal(TOKEN_2022_PROGRAM_ID.toBase58());
      expect(ix.keys).to.have.length(2);
      expect(ix.keys[0]!.pubkey.toBase58()).to.equal(aliceAta.toBase58());
      expect(ix.keys[0]!.isWritable).to.equal(true);
      expect(ix.keys[1]!.pubkey.toBase58()).to.equal(alice.publicKey.toBase58());
      expect(ix.keys[1]!.isSigner).to.equal(true);

      // discriminator(1) + sub(1) + counter(8) + newBalance(36) = 46
      expect(ix.data.length).to.equal(46);
      expect(ix.data[0]).to.equal(CONFIDENTIAL_TRANSFER_DISCRIMINATOR);
      expect(ix.data[1]).to.equal(CT_APPLY_PENDING_BALANCE);
    });

    it('buildApplyPendingBalanceIx rejects wrong-sized balance', () => {
      expect(() =>
        buildApplyPendingBalanceIx(
          aliceAta, alice.publicKey, 1n, new Uint8Array(20),
        ),
      ).to.throw('newDecryptableAvailableBalance must be 36 bytes');
    });
  });

  describe('governance feature gate', () => {
    it('confidential_transfers_enabled defaults to false', async () => {
      const config = await feeProgram.account.feeCollectorConfig.fetch(configPda);
      expect(config.confidentialTransfersEnabled).to.equal(false);
    });

    it('set_confidential_transfers toggles the flag', async () => {
      await feeProgram.methods
        .setConfidentialTransfers(true)
        .accountsPartial({ authority: metaAuthority.publicKey })
        .signers([metaAuthority])
        .rpc();

      let config = await feeProgram.account.feeCollectorConfig.fetch(configPda);
      expect(config.confidentialTransfersEnabled).to.equal(true);

      await feeProgram.methods
        .setConfidentialTransfers(false)
        .accountsPartial({ authority: metaAuthority.publicKey })
        .signers([metaAuthority])
        .rpc();

      config = await feeProgram.account.feeCollectorConfig.fetch(configPda);
      expect(config.confidentialTransfersEnabled).to.equal(false);
    });

    it('non-meta_authority cannot toggle', async () => {
      try {
        await feeProgram.methods
          .setConfidentialTransfers(true)
          .accountsPartial({ authority: alice.publicKey })
          .signers([alice])
          .rpc();
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(e.toString()).to.include('Unauthorized');
      }
    });
  });
});
