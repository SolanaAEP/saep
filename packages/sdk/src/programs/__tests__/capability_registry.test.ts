import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/capability_registry.json' with { type: 'json' };
import type { CapabilityRegistry } from '../../generated/capability_registry.js';
import { capabilityConfigPda } from '../../pda/index.js';
import {
  buildProposeTagIx,
  buildRetireTagIx,
  buildValidateMaskIx,
} from '../capability_registry.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F');

const program = makeTestProgram<CapabilityRegistry>(idl as Record<string, unknown>, PROG);

const authority = PublicKey.unique();
const payer = PublicKey.unique();
const tag = PublicKey.unique();
const slug = new Uint8Array(32).fill(0xab);
const manifestUri = new Uint8Array(96).fill(0xcd);

describe('buildProposeTagIx', () => {
  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildProposeTagIx(program, {
      authority,
      payer,
      tag,
      bitIndex: 7,
      slug,
      manifestUri,
    });
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'propose_tag'));
    const [config] = capabilityConfigPda(PROG);
    expect(accountKeys(ix)).toEqual([
      config.toBase58(),
      tag.toBase58(),
      authority.toBase58(),
      payer.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(ix.keys[2].isSigner).toBe(true);
    expect(ix.keys[3].isSigner).toBe(true);
    expect(ix.keys[3].isWritable).toBe(true);
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const ix = await buildProposeTagIx(program, {
      authority,
      payer,
      tag,
      bitIndex: 31,
      slug,
      manifestUri,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('propose_tag');
    const data = decoded.data as { bit_index: number; slug: number[]; manifest_uri: number[] };
    expect(data.bit_index).toBe(31);
    expect(data.slug).toEqual(Array.from(slug));
    expect(data.manifest_uri).toEqual(Array.from(manifestUri));
  });

  it('encodes bit_index = 0 boundary', async () => {
    const ix = await buildProposeTagIx(program, { authority, payer, tag, bitIndex: 0, slug, manifestUri });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect((decoded.data as { bit_index: number }).bit_index).toBe(0);
  });
});

describe('buildRetireTagIx', () => {
  it('returns ix with correct discriminator + accounts', async () => {
    const ix = await buildRetireTagIx(program, { authority, tag, bitIndex: 12 });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'retire_tag'));
    const [config] = capabilityConfigPda(PROG);
    expect(accountKeys(ix)).toEqual([config.toBase58(), tag.toBase58(), authority.toBase58()]);
    expect(ix.keys[2].isSigner).toBe(true);
  });

  it('round-trips bit_index', async () => {
    const ix = await buildRetireTagIx(program, { authority, tag, bitIndex: 5 });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('retire_tag');
    expect((decoded.data as { bit_index: number }).bit_index).toBe(5);
  });
});

describe('buildValidateMaskIx', () => {
  it('returns ix with correct discriminator + 1 account', async () => {
    const ix = await buildValidateMaskIx(program, { mask: 0xffn });
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'validate_mask'));
    const [config] = capabilityConfigPda(PROG);
    expect(accountKeys(ix)).toEqual([config.toBase58()]);
  });

  it('round-trips mask u64', async () => {
    const mask = 0xdeadbeefcafebaben;
    const ix = await buildValidateMaskIx(program, { mask });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    const data = decoded.data as { mask: { toString(): string } };
    expect(data.mask.toString()).toBe(mask.toString());
  });

  it('encodes zero mask', async () => {
    const ix = await buildValidateMaskIx(program, { mask: 0n });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect((decoded.data as { mask: { toString(): string } }).mask.toString()).toBe('0');
  });
});
