import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/template_registry.json' with { type: 'json' };
import type { TemplateRegistry } from '../../generated/template_registry.js';
import { templateGlobalPda, templatePda, rentalPda, rentalEscrowPda, forkPda } from '../../pda/index.js';
import {
  buildMintTemplateIx,
  buildUpdateTemplateIx,
  buildRetireTemplateIx,
  buildForkTemplateIx,
  buildOpenRentalIx,
  buildCloseRentalIx,
  buildClaimRentalRevenueIx,
} from '../template_registry.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('3QE649JDQbbudJX5j3VkmRSiRvfcu3mHCymPxZn9KC3e');

const program = makeTestProgram<TemplateRegistry>(idl as Record<string, unknown>, PROG);

const author = PublicKey.unique();
const forker = PublicKey.unique();
const renter = PublicKey.unique();
const signer = PublicKey.unique();
const cranker = PublicKey.unique();
const mint = PublicKey.unique();
const tokenProgram = PublicKey.unique();
const templateId = new Uint8Array(32).fill(0xaa);
const configHash = new Uint8Array(32).fill(0xbb);
const configUri = new Uint8Array(128).fill(0xcc);

describe('buildMintTemplateIx', () => {
  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildMintTemplateIx(program, {
      author,
      templateId,
      configHash,
      configUri,
      capabilityMask: 0xffn,
      royaltyBps: 500,
      rentPricePerSec: 100n,
      minRentDuration: 3600n,
      maxRentDuration: 86400n,
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'mint_template'));
    const [global] = templateGlobalPda(PROG);
    const [template] = templatePda(PROG, templateId);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      template.toBase58(),
      author.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[2].isSigner).toBe(true);
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const ix = await buildMintTemplateIx(program, {
      author,
      templateId,
      configHash,
      configUri,
      capabilityMask: 0xdeadbeefn,
      royaltyBps: 250,
      rentPricePerSec: 50n,
      minRentDuration: 1800n,
      maxRentDuration: 43200n,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('mint_template');
    const data = decoded.data as Record<string, unknown>;
    expect(data.template_id).toEqual(Array.from(templateId));
    expect(data.config_hash).toEqual(Array.from(configHash));
    expect(data.config_uri).toEqual(Array.from(configUri));
    expect((data.capability_mask as { toString(): string }).toString()).toBe('3735928559');
    expect(data.royalty_bps).toBe(250);
    expect((data.rent_price_per_sec as { toString(): string }).toString()).toBe('50');
  });
});

describe('buildUpdateTemplateIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildUpdateTemplateIx(program, { author, templateId, configHash, configUri });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'update_template'));
    const [global] = templateGlobalPda(PROG);
    const [template] = templatePda(PROG, templateId);
    expect(accountKeys(ix)).toEqual([global.toBase58(), template.toBase58(), author.toBase58()]);
    expect(ix.keys[2].isSigner).toBe(true);
  });

  it('round-trips configHash + configUri', async () => {
    const ix = await buildUpdateTemplateIx(program, { author, templateId, configHash, configUri });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('update_template');
    const data = decoded.data as Record<string, unknown>;
    expect(data.config_hash).toEqual(Array.from(configHash));
    expect(data.config_uri).toEqual(Array.from(configUri));
  });
});

describe('buildRetireTemplateIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildRetireTemplateIx(program, { signer, templateId });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'retire_template'));
    const [global] = templateGlobalPda(PROG);
    const [template] = templatePda(PROG, templateId);
    expect(accountKeys(ix)).toEqual([global.toBase58(), template.toBase58(), signer.toBase58()]);
    expect(ix.keys[2].isSigner).toBe(true);
  });
});

describe('buildForkTemplateIx', () => {
  const childAgentDid = new Uint8Array(32).fill(0xdd);
  const parentTemplateId = new Uint8Array(32).fill(0xee);

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildForkTemplateIx(program, { forker, parentTemplateId, childAgentDid });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'fork_template'));
    const [global] = templateGlobalPda(PROG);
    const [parent] = templatePda(PROG, parentTemplateId);
    const [fork] = forkPda(PROG, childAgentDid);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      parent.toBase58(),
      fork.toBase58(),
      forker.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[3].isSigner).toBe(true);
  });

  it('round-trips childAgentDid', async () => {
    const ix = await buildForkTemplateIx(program, { forker, parentTemplateId, childAgentDid });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('fork_template');
    const data = decoded.data as Record<string, unknown>;
    expect(data.child_agent_did).toEqual(Array.from(childAgentDid));
  });
});

describe('buildOpenRentalIx', () => {
  const rentalNonce = new Uint8Array(8).fill(0xff);
  const renterTokenAccount = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildOpenRentalIx(program, {
      renter,
      templateId,
      mint,
      renterTokenAccount,
      durationSecs: 7200n,
      rentalNonce,
      tokenProgram,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'open_rental'));
    const [global] = templateGlobalPda(PROG);
    const [template] = templatePda(PROG, templateId);
    const [rental] = rentalPda(PROG, template, renter, rentalNonce);
    const [escrow] = rentalEscrowPda(PROG, rental);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      template.toBase58(),
      rental.toBase58(),
      mint.toBase58(),
      escrow.toBase58(),
      renterTokenAccount.toBase58(),
      renter.toBase58(),
      tokenProgram.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[6].isSigner).toBe(true);
  });

  it('round-trips durationSecs + rentalNonce', async () => {
    const ix = await buildOpenRentalIx(program, {
      renter,
      templateId,
      mint,
      renterTokenAccount,
      durationSecs: 3600n,
      rentalNonce,
      tokenProgram,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('open_rental');
    const data = decoded.data as Record<string, unknown>;
    expect((data.duration_secs as { toString(): string }).toString()).toBe('3600');
    expect(data.rental_nonce).toEqual(Array.from(rentalNonce));
  });
});

describe('buildCloseRentalIx', () => {
  const rental = PublicKey.unique();
  const authorTokenAccount = PublicKey.unique();
  const feeCollectorTokenAccount = PublicKey.unique();
  const renterTokenAccount = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildCloseRentalIx(program, {
      signer,
      rental,
      templateId,
      mint,
      authorTokenAccount,
      feeCollectorTokenAccount,
      renterTokenAccount,
      tokenProgram,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'close_rental'));
    const [global] = templateGlobalPda(PROG);
    const [template] = templatePda(PROG, templateId);
    const [escrow] = rentalEscrowPda(PROG, rental);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      template.toBase58(),
      rental.toBase58(),
      mint.toBase58(),
      escrow.toBase58(),
      authorTokenAccount.toBase58(),
      feeCollectorTokenAccount.toBase58(),
      renterTokenAccount.toBase58(),
      signer.toBase58(),
      tokenProgram.toBase58(),
    ]);
    expect(ix.keys[8].isSigner).toBe(true);
  });
});

describe('buildClaimRentalRevenueIx', () => {
  const rental = PublicKey.unique();
  const authorTokenAccount = PublicKey.unique();
  const feeCollectorTokenAccount = PublicKey.unique();

  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildClaimRentalRevenueIx(program, {
      cranker,
      rental,
      templateId,
      mint,
      authorTokenAccount,
      feeCollectorTokenAccount,
      tokenProgram,
    });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'claim_rental_revenue'));
    const [global] = templateGlobalPda(PROG);
    const [template] = templatePda(PROG, templateId);
    const [escrow] = rentalEscrowPda(PROG, rental);
    expect(accountKeys(ix)).toEqual([
      global.toBase58(),
      template.toBase58(),
      rental.toBase58(),
      mint.toBase58(),
      escrow.toBase58(),
      authorTokenAccount.toBase58(),
      feeCollectorTokenAccount.toBase58(),
      cranker.toBase58(),
      tokenProgram.toBase58(),
    ]);
    expect(ix.keys[7].isSigner).toBe(true);
  });
});
