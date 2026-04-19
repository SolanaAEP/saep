import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import idl from '../../idl/agent_registry.json' with { type: 'json' };
import type { AgentRegistry } from '../../generated/agent_registry.js';
import { agentRegistryGlobalPda, agentStakePda, capabilityConfigPda } from '../../pda/index.js';
import { TOKEN_2022_PROGRAM_ID } from '../register_agent.js';
import {
  buildUpdateManifestIx,
  buildStakeIncreaseIx,
  buildRequestStakeWithdrawIx,
  buildExecuteStakeWithdrawIx,
  buildDeregisterIx,
  buildReactivateIx,
} from '../agent_registry.js';
import { makeTestProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu');
const program = makeTestProgram<AgentRegistry>(idl as Record<string, unknown>, PROG);

const operator = PublicKey.unique();
const agent = PublicKey.unique();
const stakeMint = PublicKey.unique();
const operatorTokenAccount = PublicKey.unique();
const capabilityRegistryProgramId = PublicKey.unique();

describe('buildUpdateManifestIx', () => {
  it('returns ix with correct discriminator and accounts', async () => {
    const ix = await buildUpdateManifestIx(program, {
      operator,
      agent,
      manifestUri: 'https://example.com/v2',
      capabilityMask: 0xbn,
      priceLamports: 500n,
      streamRate: 10n,
      capabilityRegistryProgramId,
    });

    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'update_manifest'));

    const [global] = agentRegistryGlobalPda(PROG);
    const [capConfig] = capabilityConfigPda(capabilityRegistryProgramId);

    expect(accountKeys(ix)).toContain(global.toBase58());
    expect(accountKeys(ix)).toContain(capConfig.toBase58());
    expect(accountKeys(ix)).toContain(agent.toBase58());
    expect(accountKeys(ix)).toContain(operator.toBase58());

    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
  });

  it('round-trips args', async () => {
    const ix = await buildUpdateManifestIx(program, {
      operator,
      agent,
      manifestUri: 'ar://abc',
      capabilityMask: 255n,
      priceLamports: 9999n,
      streamRate: 77n,
      capabilityRegistryProgramId,
    });

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('update_manifest');
    const data = decoded.data as {
      capability_mask: { toString(): string };
      price_lamports: { toString(): string };
      stream_rate: { toString(): string };
    };
    expect(data.capability_mask.toString()).toBe('255');
    expect(data.price_lamports.toString()).toBe('9999');
    expect(data.stream_rate.toString()).toBe('77');
  });
});

describe('buildStakeIncreaseIx', () => {
  it('returns ix with correct discriminator and accounts', async () => {
    const ix = await buildStakeIncreaseIx(program, {
      operator,
      agent,
      stakeMint,
      operatorTokenAccount,
      amount: 5000n,
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'stake_increase'));

    const [global] = agentRegistryGlobalPda(PROG);
    const [stakeVault] = agentStakePda(PROG, agent);
    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys[1]).toBe(agent.toBase58());
    expect(keys).toContain(stakeVault.toBase58());
    expect(keys).toContain(TOKEN_2022_PROGRAM_ID.toBase58());

    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
  });

  it('round-trips amount', async () => {
    const ix = await buildStakeIncreaseIx(program, {
      operator,
      agent,
      stakeMint,
      operatorTokenAccount,
      amount: 123_456_789n,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('stake_increase');
    expect((decoded.data as { amount: { toString(): string } }).amount.toString()).toBe('123456789');
  });
});

describe('buildRequestStakeWithdrawIx', () => {
  it('returns ix with correct discriminator and operator is signer', async () => {
    const ix = await buildRequestStakeWithdrawIx(program, { operator, agent, amount: 100n });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'stake_withdraw_request'));
    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
  });

  it('round-trips amount', async () => {
    const ix = await buildRequestStakeWithdrawIx(program, { operator, agent, amount: 777n });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('stake_withdraw_request');
    expect((decoded.data as { amount: { toString(): string } }).amount.toString()).toBe('777');
  });
});

describe('buildExecuteStakeWithdrawIx', () => {
  it('returns ix with correct discriminator and no args', async () => {
    const ix = await buildExecuteStakeWithdrawIx(program, {
      operator,
      agent,
      stakeMint,
      operatorTokenAccount,
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'stake_withdraw_execute'));
    expect(ix.data.length).toBe(8);

    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
  });
});

describe('buildDeregisterIx', () => {
  it('returns set_status ix with deregistered variant', async () => {
    const ix = await buildDeregisterIx(program, { operator, agent });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'set_status'));

    const [global] = agentRegistryGlobalPda(PROG);
    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys[1]).toBe(agent.toBase58());

    const signerKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(signerKey.isSigner).toBe(true);

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('set_status');
    const data = decoded.data as { new_status: Record<string, unknown> };
    expect(data.new_status).toHaveProperty('Deregistered');
  });
});

describe('buildReactivateIx', () => {
  it('returns set_status ix with active variant', async () => {
    const ix = await buildReactivateIx(program, { operator, agent });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'set_status'));

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('set_status');
    const data = decoded.data as { new_status: Record<string, unknown> };
    expect(data.new_status).toHaveProperty('Active');
  });
});
