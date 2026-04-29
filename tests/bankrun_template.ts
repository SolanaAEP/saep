import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock, warpClockBy } from './helpers/bankrun';
import { padBytes } from './helpers/encoding';
import { createMint, createATA, mintTokens, getTokenBalance } from './helpers/token';
import {
  Keypair, PublicKey, SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { TemplateRegistry } from '../target/types/template_registry';

const T0 = 1_700_000_000n;
const ROYALTY_CAP_BPS = 2000;
const PLATFORM_FEE_BPS = 500;
const DECIMALS = 6;
const MINT_AMOUNT = 100_000_000;

const enc = (s: string) => Buffer.from(s);
const PROGRAM_ID = new PublicKey('3QE649JDQbbudJX5j3VkmRSiRvfcu3mHCymPxZn9KC3e');

function templateId(label: string): number[] {
  return padBytes(label, 32) as unknown as number[];
}

function templateIdBuf(label: string): Buffer {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(label, 'utf8').copy(buf);
  return buf;
}

function configHash(s: string): number[] {
  return padBytes(s, 32) as unknown as number[];
}

function configUri(s: string): number[] {
  return padBytes(s, 128) as unknown as number[];
}

function globalPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('tpl_global')], PROGRAM_ID);
}

function tplPda(id: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('template'), id], PROGRAM_ID);
}

function forkPda(childDid: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('fork'), childDid], PROGRAM_ID);
}

function rentalPda(template: PublicKey, renter: PublicKey, nonce: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc('rental'), template.toBuffer(), renter.toBuffer(), nonce],
    PROGRAM_ID,
  );
}

function rentalEscrowPda(rental: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc('rental_escrow'), rental.toBuffer()], PROGRAM_ID);
}

describe('bankrun: template_registry — mint, fork, rental lifecycle', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let program: anchor.Program<TemplateRegistry>;

  let authority: Keypair;
  const author = Keypair.generate();
  const renter = Keypair.generate();
  const feeCollectorKp = Keypair.generate();
  const mintAuthority = Keypair.generate();

  let mint: PublicKey;
  let authorAta: PublicKey;
  let renterAta: PublicKey;
  let feeCollectorAta: PublicKey;

  const [globalPdaKey] = globalPda();

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const idl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/template_registry.json'), 'utf8'));
    program = new anchor.Program<TemplateRegistry>(idl, provider);

    for (const kp of [author, renter, feeCollectorKp, mintAuthority]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    mint = await createMint(context, authority, mintAuthority.publicKey, DECIMALS, TOKEN_PROGRAM_ID);

    authorAta = await createATA(context, authority, mint, author.publicKey, TOKEN_PROGRAM_ID);
    renterAta = await createATA(context, authority, mint, renter.publicKey, TOKEN_PROGRAM_ID);
    feeCollectorAta = await createATA(context, authority, mint, feeCollectorKp.publicKey, TOKEN_PROGRAM_ID);

    await mintTokens(context, authority, mint, renterAta, mintAuthority, MINT_AMOUNT, TOKEN_PROGRAM_ID);

    await program.methods
      .initGlobal(
        PublicKey.default,
        PublicKey.default,
        feeCollectorAta,
        ROYALTY_CAP_BPS,
        PLATFORM_FEE_BPS,
        mint,
      )
      .accountsPartial({
        global: globalPdaKey,
        authority: authority.publicKey,
      })
      .rpc();
  });

  it('init_global creates config with correct fields', async () => {
    const g = await program.account.templateRegistryGlobal.fetch(globalPdaKey);
    expect(g.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(g.royaltyCapBps).to.equal(ROYALTY_CAP_BPS);
    expect(g.platformFeeBps).to.equal(PLATFORM_FEE_BPS);
    expect(g.rentEscrowMint.toBase58()).to.equal(mint.toBase58());
    expect(g.paused).to.equal(false);
  });

  const tplLabel = 'test-template-001';
  const tplIdArr = templateId(tplLabel);
  const tplIdBuf = templateIdBuf(tplLabel);
  let templatePda: PublicKey;

  it('mint_template — Published status, royalty_bps set, lineage_depth=0', async () => {
    [templatePda] = tplPda(tplIdBuf);

    await program.methods
      .mintTemplate(
        tplIdArr,
        configHash('hash-001'),
        configUri('ipfs://template/001'),
        new BN(0xff),
        1000,
        new BN(100),
        new BN(60),
        new BN(3600),
      )
      .accountsPartial({
        global: globalPdaKey,
        template: templatePda,
        author: author.publicKey,
      })
      .signers([author])
      .rpc();

    const t = await program.account.agentTemplate.fetch(templatePda);
    expect(JSON.stringify(t.status)).to.equal(JSON.stringify({ published: {} }));
    expect(t.royaltyBps).to.equal(1000);
    expect(t.lineageDepth).to.equal(0);
    expect(t.forkCount).to.equal(0);
    expect(t.rentPricePerSec.toNumber()).to.equal(100);
    expect(t.author.toBase58()).to.equal(author.publicKey.toBase58());
  });

  it('mint_template royalty exceeds cap — RoyaltyExceedsCap error', async () => {
    const badId = templateId('over-cap-tpl');
    const badIdBuf = templateIdBuf('over-cap-tpl');
    const [badPda] = tplPda(badIdBuf);

    let err: unknown;
    try {
      await program.methods
        .mintTemplate(
          badId,
          configHash('hash-bad'),
          configUri('ipfs://bad'),
          new BN(1),
          ROYALTY_CAP_BPS + 1,
          new BN(0),
          new BN(0),
          new BN(0),
        )
        .accountsPartial({
          global: globalPdaKey,
          template: badPda,
          author: author.publicKey,
        })
        .signers([author])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/RoyaltyExceedsCap/);
  });

  it('fork_template — TemplateFork created, parent.fork_count incremented, lineage_depth snapshot', async () => {
    const childDid = templateIdBuf('fork-child-001');
    const childDidArr = Array.from(childDid) as unknown as number[];
    const [forkPdaKey] = forkPda(childDid);

    await program.methods
      .forkTemplate(childDidArr)
      .accountsPartial({
        global: globalPdaKey,
        parent: templatePda,
        fork: forkPdaKey,
        forker: author.publicKey,
      })
      .signers([author])
      .rpc();

    const f = await program.account.templateFork.fetch(forkPdaKey);
    expect(f.parentTemplate.toBase58()).to.equal(templatePda.toBase58());
    expect(f.forker.toBase58()).to.equal(author.publicKey.toBase58());
    expect(f.royaltyBpsSnapshot).to.equal(1000);

    const parent = await program.account.agentTemplate.fetch(templatePda);
    expect(parent.forkCount).to.equal(1);
  });

  it('fork_template with second child — creates distinct fork, fork_count=2', async () => {
    const childDid2 = templateIdBuf('fork-child-002');
    const childDidArr2 = Array.from(childDid2) as unknown as number[];
    const [forkPda2] = forkPda(childDid2);

    await program.methods
      .forkTemplate(childDidArr2)
      .accountsPartial({
        global: globalPdaKey,
        parent: templatePda,
        fork: forkPda2,
        forker: renter.publicKey,
      })
      .signers([renter])
      .rpc();

    const f = await program.account.templateFork.fetch(forkPda2);
    expect(f.forker.toBase58()).to.equal(renter.publicKey.toBase58());
    expect(f.parentTemplate.toBase58()).to.equal(templatePda.toBase58());

    const parent = await program.account.agentTemplate.fetch(templatePda);
    expect(parent.forkCount).to.equal(2);
  });

  const rentalNonce = Buffer.alloc(8, 0);
  rentalNonce.write('rent-01', 'utf8');
  let rentalPdaKey: PublicKey;
  let escrowPdaKey: PublicKey;

  it('open_rental — prepaid transferred to escrow, rental Active with correct times', async () => {
    const durationSecs = 600;
    const rentPricePerSec = 100;
    const expectedPrepaid = durationSecs * rentPricePerSec;

    [rentalPdaKey] = rentalPda(templatePda, renter.publicKey, rentalNonce);
    [escrowPdaKey] = rentalEscrowPda(rentalPdaKey);

    const renterBefore = await getTokenBalance(context, renterAta);

    await program.methods
      .openRental(
        new BN(durationSecs),
        Array.from(rentalNonce) as unknown as number[],
      )
      .accountsPartial({
        global: globalPdaKey,
        template: templatePda,
        rental: rentalPdaKey,
        mint,
        escrow: escrowPdaKey,
        renterTokenAccount: renterAta,
        renter: renter.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([renter])
      .rpc();

    const renterAfter = await getTokenBalance(context, renterAta);
    const escrowBal = await getTokenBalance(context, escrowPdaKey);
    expect(Number(renterBefore - renterAfter)).to.equal(expectedPrepaid);
    expect(Number(escrowBal)).to.equal(expectedPrepaid);

    const rental = await program.account.templateRental.fetch(rentalPdaKey);
    expect(JSON.stringify(rental.status)).to.equal(JSON.stringify({ active: {} }));
    expect(rental.prepaidAmount.toNumber()).to.equal(expectedPrepaid);
    expect(rental.dripRatePerSec.toNumber()).to.equal(rentPricePerSec);
    expect(rental.template.toBase58()).to.equal(templatePda.toBase58());
    expect(rental.renter.toBase58()).to.equal(renter.publicKey.toBase58());
    expect(rental.endTime.toNumber()).to.equal(rental.startTime.toNumber() + durationSecs);
  });

  it('claim_rental_revenue — splits correct between author + platform', async () => {
    await warpClockBy(context, 300);

    const authorBefore = await getTokenBalance(context, authorAta);
    const feeBefore = await getTokenBalance(context, feeCollectorAta);

    await program.methods
      .claimRentalRevenue()
      .accountsPartial({
        global: globalPdaKey,
        template: templatePda,
        rental: rentalPdaKey,
        mint,
        escrow: escrowPdaKey,
        authorTokenAccount: authorAta,
        feeCollectorTokenAccount: feeCollectorAta,
        cranker: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const authorAfter = await getTokenBalance(context, authorAta);
    const feeAfter = await getTokenBalance(context, feeCollectorAta);

    // 300 seconds * 100 per sec = 30_000 accrued
    // author royalty: 30_000 * 1000/10_000 = 3_000
    // platform fee: 30_000 * 500/10_000 = 1_500
    const authorGain = Number(authorAfter - authorBefore);
    const feeGain = Number(feeAfter - feeBefore);
    expect(authorGain).to.equal(3_000);
    expect(feeGain).to.equal(1_500);

    const rental = await program.account.templateRental.fetch(rentalPdaKey);
    expect(rental.claimedAuthor.toNumber()).to.equal(3_000);
    expect(rental.claimedPlatform.toNumber()).to.equal(1_500);
  });

  it('close_rental by renter (early) — refund balance, status Cancelled', async () => {
    // We're at T0 + 300s. Rental duration is 600s, so still active.
    const renterBefore = await getTokenBalance(context, renterAta);
    const authorBefore = await getTokenBalance(context, authorAta);
    const feeBefore = await getTokenBalance(context, feeCollectorAta);

    await program.methods
      .closeRental()
      .accountsPartial({
        global: globalPdaKey,
        template: templatePda,
        rental: rentalPdaKey,
        mint,
        escrow: escrowPdaKey,
        authorTokenAccount: authorAta,
        feeCollectorTokenAccount: feeCollectorAta,
        renterTokenAccount: renterAta,
        signer: renter.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([renter])
      .rpc();

    const rental = await program.account.templateRental.fetch(rentalPdaKey);
    expect(JSON.stringify(rental.status)).to.equal(JSON.stringify({ cancelled: {} }));

    const renterAfter = await getTokenBalance(context, renterAta);
    // Renter should get refund of remaining escrow after final accrual distribution
    expect(Number(renterAfter)).to.be.greaterThan(Number(renterBefore));
  });

  it('close_rental after end — status Closed', async () => {
    // Create a second rental, warp past end, then close
    const nonce2 = Buffer.alloc(8, 0);
    nonce2.write('rent-02', 'utf8');
    const durationSecs = 120;

    const [rental2Pda] = rentalPda(templatePda, renter.publicKey, nonce2);
    const [escrow2Pda] = rentalEscrowPda(rental2Pda);

    await program.methods
      .openRental(
        new BN(durationSecs),
        Array.from(nonce2) as unknown as number[],
      )
      .accountsPartial({
        global: globalPdaKey,
        template: templatePda,
        rental: rental2Pda,
        mint,
        escrow: escrow2Pda,
        renterTokenAccount: renterAta,
        renter: renter.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([renter])
      .rpc();

    // Warp past end
    await warpClockBy(context, durationSecs + 10);

    // Anyone can close after end_time
    await program.methods
      .closeRental()
      .accountsPartial({
        global: globalPdaKey,
        template: templatePda,
        rental: rental2Pda,
        mint,
        escrow: escrow2Pda,
        authorTokenAccount: authorAta,
        feeCollectorTokenAccount: feeCollectorAta,
        renterTokenAccount: renterAta,
        signer: authority.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const rental2 = await program.account.templateRental.fetch(rental2Pda);
    expect(JSON.stringify(rental2.status)).to.equal(JSON.stringify({ closed: {} }));
  });

  it('retire_template — status Retired', async () => {
    await program.methods
      .retireTemplate()
      .accountsPartial({
        global: globalPdaKey,
        template: templatePda,
        signer: author.publicKey,
      })
      .signers([author])
      .rpc();

    const t = await program.account.agentTemplate.fetch(templatePda);
    expect(JSON.stringify(t.status)).to.equal(JSON.stringify({ retired: {} }));
  });

  it('retire_template by global authority also works', async () => {
    // Mint a fresh template so it's Published
    const freshLabel = 'retire-by-auth';
    const freshIdBuf = templateIdBuf(freshLabel);
    const freshIdArr = templateId(freshLabel);
    const [freshPda] = tplPda(freshIdBuf);

    await program.methods
      .mintTemplate(
        freshIdArr,
        configHash('hash-retire'),
        configUri('ipfs://retire-test'),
        new BN(1),
        500,
        new BN(0),
        new BN(0),
        new BN(0),
      )
      .accountsPartial({
        global: globalPdaKey,
        template: freshPda,
        author: author.publicKey,
      })
      .signers([author])
      .rpc();

    // Authority (not author) retires it
    await program.methods
      .retireTemplate()
      .accountsPartial({
        global: globalPdaKey,
        template: freshPda,
        signer: authority.publicKey,
      })
      .rpc();

    const t = await program.account.agentTemplate.fetch(freshPda);
    expect(JSON.stringify(t.status)).to.equal(JSON.stringify({ retired: {} }));
  });
});
