import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import idl from '../../idl/agent_registry.json' with { type: 'json' };
import type { AgentRegistry } from '../../generated/agent_registry.js';
import { agentAccountPda, agentRegistryGlobalPda, agentStakePda, capabilityConfigPda } from '../../pda/index.js';
import {
  buildRegisterAgentIx,
  encodeAgentId,
  encodeManifestUri,
  AGENT_ID_LEN,
  MANIFEST_URI_LEN,
  TOKEN_2022_PROGRAM_ID,
} from '../register_agent.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu');
const CAP_PROG = new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F');

const program = makeTestProgram<AgentRegistry>(idl as Record<string, unknown>, PROG);

const operator = PublicKey.unique();
const stakeMint = PublicKey.unique();
const operatorTokenAccount = PublicKey.unique();
const agentId = encodeAgentId('agent-test-001');

const baseInput = {
  operator,
  agentId,
  manifestUri: 'https://example.com/manifest.json',
  capabilityMask: 0xffn,
  priceLamports: 1_000_000n,
  streamRate: 0n,
  stakeAmount: 100_000_000n,
  stakeMint,
  operatorTokenAccount,
  capabilityRegistryProgramId: CAP_PROG,
};

describe('encodeAgentId', () => {
  it('zero-pads to 32 bytes', () => {
    const buf = encodeAgentId('hi');
    expect(buf.length).toBe(AGENT_ID_LEN);
    expect(buf[0]).toBe('h'.charCodeAt(0));
    expect(buf[1]).toBe('i'.charCodeAt(0));
    expect(buf[2]).toBe(0);
    expect(buf[31]).toBe(0);
  });

  it('throws on >32 bytes', () => {
    expect(() => encodeAgentId('x'.repeat(33))).toThrow();
  });

  it('handles exactly 32 bytes', () => {
    const buf = encodeAgentId('x'.repeat(32));
    expect(buf.length).toBe(32);
    expect(buf[31]).toBe('x'.charCodeAt(0));
  });
});

describe('encodeManifestUri', () => {
  it('zero-pads to 128 bytes', () => {
    const buf = encodeManifestUri('https://x.com/a');
    expect(buf.length).toBe(MANIFEST_URI_LEN);
    expect(buf[14]).toBe('a'.charCodeAt(0));
    expect(buf[15]).toBe(0);
  });

  it('throws on >128 bytes', () => {
    expect(() => encodeManifestUri('x'.repeat(129))).toThrow();
  });

  it('handles utf-8 multi-byte under cap', () => {
    const buf = encodeManifestUri('é'.repeat(60));
    expect(buf.length).toBe(MANIFEST_URI_LEN);
  });

  it('throws on utf-8 multi-byte over cap', () => {
    expect(() => encodeManifestUri('é'.repeat(65))).toThrow();
  });
});

describe('buildRegisterAgentIx', () => {
  it('returns ix with correct programId + discriminator', async () => {
    const ix = await buildRegisterAgentIx(program, baseInput);
    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'register_agent'));
  });

  it('derives global, agent, and stakeVault PDAs', async () => {
    const ix = await buildRegisterAgentIx(program, baseInput);
    const [global] = agentRegistryGlobalPda(PROG);
    const [agent] = agentAccountPda(PROG, operator, agentId);
    const [stakeVault] = agentStakePda(PROG, agent);
    const keys = accountKeys(ix);
    expect(keys).toContain(global.toBase58());
    expect(keys).toContain(agent.toBase58());
    expect(keys).toContain(stakeVault.toBase58());
  });

  it('uses Token-2022 program id for tokenProgram account', async () => {
    const ix = await buildRegisterAgentIx(program, baseInput);
    expect(accountKeys(ix)).toContain(TOKEN_2022_PROGRAM_ID.toBase58());
  });

  it('marks operator as signer + writable', async () => {
    const ix = await buildRegisterAgentIx(program, baseInput);
    const opKey = ix.keys.find((k) => k.pubkey.equals(operator));
    expect(opKey?.isSigner).toBe(true);
    expect(opKey?.isWritable).toBe(true);
  });

  it('uses cap_registry program id for capabilityConfig PDA', async () => {
    const ix = await buildRegisterAgentIx(program, baseInput);
    const capConfig = capabilityConfigPda(CAP_PROG)[0];
    expect(accountKeys(ix)).toContain(capConfig.toBase58());
  });

  it('round-trips args via BorshInstructionCoder', async () => {
    const ix = await buildRegisterAgentIx(program, baseInput);
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('register_agent');
    const data = decoded.data as {
      agent_id: number[];
      capability_mask: { toString(): string };
      price_lamports: { toString(): string };
      stake_amount: { toString(): string };
    };
    expect(data.agent_id).toEqual(Array.from(agentId));
    expect(data.capability_mask.toString()).toBe('255');
    expect(data.price_lamports.toString()).toBe('1000000');
    expect(data.stake_amount.toString()).toBe('100000000');
  });

  it('encodes capability_mask as u128', async () => {
    const big = (1n << 100n) | 0xdeadn;
    const ix = await buildRegisterAgentIx(program, { ...baseInput, capabilityMask: big });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    const data = decoded.data as { capability_mask: { toString(): string } };
    expect(data.capability_mask.toString()).toBe(big.toString());
  });
});
