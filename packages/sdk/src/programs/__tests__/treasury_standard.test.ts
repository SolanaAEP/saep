import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import idl from '../../idl/treasury_standard.json' with { type: 'json' };
import type { TreasuryStandard } from '../../generated/treasury_standard.js';
import {
  treasuryGlobalPda,
  treasuryPda,
  treasuryAllowedMintsPda,
  treasuryYieldConfigPda,
  treasuryYieldStrategyPda,
  vaultPda,
  agentRegistryGlobalPda,
  agentAccountPda,
  streamPda,
  streamEscrowPda,
} from '../../pda/index.js';
import {
  buildInitTreasuryIx,
  buildSetLimitsIx,
  buildWithdrawIx,
  buildInitStreamIx,
  buildCloseStreamIx,
  buildWithdrawEarnedIx,
  buildRecordTreasuryYieldAccountingIx,
  buildRegisterYieldStrategyIx,
  buildRequestTreasuryYieldUnwindIx,
  buildSetTreasuryYieldConfigIx,
  buildSetYieldStrategyStatusIx,
} from '../treasury_standard.js';
import { makeTestProgram, makeRecordingProgram, decodeIx, expectedDiscriminator, accountKeys } from './helpers.js';

const PROG = new PublicKey('6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ');
const program = makeTestProgram<TreasuryStandard>(idl as Record<string, unknown>, PROG);

const operator = PublicKey.unique();
const agentDid = new Uint8Array(32).fill(0xab);
const agentOperator = PublicKey.unique();
const agentId = new Uint8Array(32).fill(0xcd);
const mint = PublicKey.unique();
const payerMint = PublicKey.unique();
const payoutMint = PublicKey.unique();
const clientTokenAccount = PublicKey.unique();
const client = PublicKey.unique();
const streamNonce = new Uint8Array(8).fill(0xef);
const strategyId = new Uint8Array(32).fill(0x42);

const clusterConfig = {
  cluster: 'devnet' as const,
  endpoint: 'http://127.0.0.1:8899',
  programIds: {
    agentRegistry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
    treasuryStandard: PROG,
    taskMarket: PublicKey.unique(),
    disputeArbitration: PublicKey.unique(),
    governanceProgram: PublicKey.unique(),
    feeCollector: PublicKey.unique(),
    proofVerifier: PublicKey.unique(),
    capabilityRegistry: PublicKey.unique(),
    nxsStaking: PublicKey.unique(),
    templateRegistry: PublicKey.unique(),
  },
};

describe('buildInitTreasuryIx', () => {
  it('returns ix with correct programId, discriminator, accounts', async () => {
    const ix = await buildInitTreasuryIx(program, clusterConfig, {
      operator,
      agentDid,
      agentOperator,
      agentId,
      dailySpendLimit: 10_000n,
      perTxLimit: 1_000n,
      weeklyLimit: 50_000n,
    });

    expect(ix.programId.equals(PROG)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'init_treasury'));

    const [global] = treasuryGlobalPda(PROG);
    const [treasury] = treasuryPda(PROG, agentDid);
    const [registryGlobal] = agentRegistryGlobalPda(clusterConfig.programIds.agentRegistry);
    const [agentAccount] = agentAccountPda(clusterConfig.programIds.agentRegistry, agentOperator, agentId);

    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys[1]).toBe(treasury.toBase58());
    expect(keys).toContain(registryGlobal.toBase58());
    expect(keys).toContain(agentAccount.toBase58());
    expect(keys).toContain(SystemProgram.programId.toBase58());

    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
    expect(operatorKey.isWritable).toBe(true);
  });

  it('round-trips args', async () => {
    const ix = await buildInitTreasuryIx(program, clusterConfig, {
      operator,
      agentDid,
      agentOperator,
      agentId,
      dailySpendLimit: 5000n,
      perTxLimit: 200n,
      weeklyLimit: 30_000n,
    });

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('init_treasury');
    const data = decoded.data as {
      agent_did: number[];
      daily_spend_limit: { toString(): string };
      per_tx_limit: { toString(): string };
      weekly_limit: { toString(): string };
    };
    expect(data.agent_did).toEqual(Array.from(agentDid));
    expect(data.daily_spend_limit.toString()).toBe('5000');
    expect(data.per_tx_limit.toString()).toBe('200');
    expect(data.weekly_limit.toString()).toBe('30000');
  });
});

describe('buildSetLimitsIx', () => {
  it('returns ix with correct discriminator and operator is signer', async () => {
    const ix = await buildSetLimitsIx(program, {
      operator,
      agentDid,
      daily: 100n,
      perTx: 10n,
      weekly: 500n,
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'set_limits'));

    const [global] = treasuryGlobalPda(PROG);
    const [treasury] = treasuryPda(PROG, agentDid);
    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys[1]).toBe(treasury.toBase58());

    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
  });

  it('round-trips args', async () => {
    const ix = await buildSetLimitsIx(program, {
      operator,
      agentDid,
      daily: 1_000_000n,
      perTx: 50_000n,
      weekly: 5_000_000n,
    });

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('set_limits');
    const data = decoded.data as {
      daily: { toString(): string };
      per_tx: { toString(): string };
      weekly: { toString(): string };
    };
    expect(data.daily.toString()).toBe('1000000');
    expect(data.per_tx.toString()).toBe('50000');
    expect(data.weekly.toString()).toBe('5000000');
  });
});

describe('buildWithdrawIx', () => {
  // Anchor resolver can't derive guard/hook_allowlist/allowed_targets in stub env
  it.skip('returns ix with correct discriminator and accounts', async () => {
    const destination = PublicKey.unique();
    const ix = await buildWithdrawIx(program, {
      operator,
      agentDid,
      mint,
      destination,
      amount: 1000n,
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'withdraw'));

    const [global] = treasuryGlobalPda(PROG);
    const [treasury] = treasuryPda(PROG, agentDid);
    const [vault] = vaultPda(PROG, agentDid, mint);
    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys[1]).toBe(treasury.toBase58());
    expect(keys).toContain(vault.toBase58());
    expect(keys).toContain(destination.toBase58());

    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
  });

  it.skip('round-trips amount', async () => {
    const ix = await buildWithdrawIx(program, {
      operator,
      agentDid,
      mint,
      destination: PublicKey.unique(),
      amount: 999_999n,
    });
    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('withdraw');
    expect((decoded.data as { amount: { toString(): string } }).amount.toString()).toBe('999999');
  });
});

describe('buildInitStreamIx', () => {
  // Anchor resolver can't derive allowed_targets/hook_allowlist/guard in stub env
  it.skip('returns ix with correct discriminator and accounts', async () => {
    const ix = await buildInitStreamIx(program, {
      client,
      agentDid,
      streamNonce,
      payerMint,
      payoutMint,
      clientTokenAccount,
      ratePerSec: 100n,
      maxDuration: 3600n,
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'init_stream'));

    const [global] = treasuryGlobalPda(PROG);
    const [allowedMints] = treasuryAllowedMintsPda(PROG);
    const [treasury] = treasuryPda(PROG, agentDid);
    const [stream] = streamPda(PROG, agentDid, client, streamNonce);
    const [escrow] = streamEscrowPda(PROG, stream);

    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys).toContain(allowedMints.toBase58());
    expect(keys).toContain(treasury.toBase58());
    expect(keys).toContain(stream.toBase58());
    expect(keys).toContain(escrow.toBase58());

    const clientKey = ix.keys.find((k) => k.pubkey.equals(client))!;
    expect(clientKey.isSigner).toBe(true);
  });

  it.skip('round-trips args', async () => {
    const ix = await buildInitStreamIx(program, {
      client,
      agentDid,
      streamNonce,
      payerMint,
      payoutMint,
      clientTokenAccount,
      ratePerSec: 42n,
      maxDuration: 7200n,
    });

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('init_stream');
    const data = decoded.data as {
      stream_nonce: number[];
      rate_per_sec: { toString(): string };
      max_duration: { toString(): string };
    };
    expect(data.stream_nonce).toEqual(Array.from(streamNonce));
    expect(data.rate_per_sec.toString()).toBe('42');
    expect(data.max_duration.toString()).toBe('7200');
  });
});

describe('buildCloseStreamIx', () => {
  // Anchor resolver can't derive hook_allowlist/agent_hooks/guard in stub env
  it.skip('returns ix with correct discriminator and no args', async () => {
    const stream = PublicKey.unique();
    const [treasury] = treasuryPda(PROG, agentDid);
    const signer = PublicKey.unique();

    const ix = await buildCloseStreamIx(program, {
      signer,
      stream,
      treasury,
      payerMint,
      agentDid,
      clientTokenAccount,
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'close_stream'));
    expect(ix.data.length).toBe(8);

    const signerKey = ix.keys.find((k) => k.pubkey.equals(signer))!;
    expect(signerKey.isSigner).toBe(true);
  });
});

describe('buildWithdrawEarnedIx', () => {
  // Anchor resolver can't derive allowed_targets/hook_allowlist/agent_hooks/guard in stub env
  it.skip('returns ix with correct discriminator and accounts', async () => {
    const stream = PublicKey.unique();
    const jupiterProgram = PublicKey.unique();
    const routeData = new Uint8Array([1, 2, 3, 4, 5]);

    const ix = await buildWithdrawEarnedIx(program, {
      operator,
      agentDid,
      stream,
      payerMint,
      payoutMint,
      jupiterProgram,
      routeData,
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'withdraw_earned'));

    const [global] = treasuryGlobalPda(PROG);
    const [treasury] = treasuryPda(PROG, agentDid);
    const [escrow] = streamEscrowPda(PROG, stream);
    const [agentVault] = vaultPda(PROG, agentDid, payoutMint);

    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys).toContain(treasury.toBase58());
    expect(keys).toContain(escrow.toBase58());
    expect(keys).toContain(agentVault.toBase58());

    const operatorKey = ix.keys.find((k) => k.pubkey.equals(operator))!;
    expect(operatorKey.isSigner).toBe(true);
  });

  it.skip('round-trips route_data', async () => {
    const routeData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const ix = await buildWithdrawEarnedIx(program, {
      operator,
      agentDid,
      stream: PublicKey.unique(),
      payerMint,
      payoutMint,
      jupiterProgram: PublicKey.unique(),
      routeData,
    });

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('withdraw_earned');
    const data = decoded.data as { route_data: { data: number[] } | number[] };
    const bytes = Array.isArray(data.route_data) ? data.route_data : data.route_data.data;
    expect(bytes).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

describe('recording-program treasury coverage', () => {
  it('covers withdraw and stream lifecycle builders without Anchor account resolution', async () => {
    const { program: recordingProgram, calls } = makeRecordingProgram<TreasuryStandard>(PROG);
    const stream = PublicKey.unique();
    const treasury = PublicKey.unique();
    const customPriceFeed = PublicKey.unique();
    const customAllowedTargets = PublicKey.unique();
    const customHookAllowlist = PublicKey.unique();
    const customAgentHooks = PublicKey.unique();
    const customTokenProgram = PublicKey.unique();
    const customJupiterProgram = PublicKey.unique();

    await buildWithdrawIx(recordingProgram, {
      operator,
      agentDid,
      mint,
      destination: PublicKey.unique(),
      amount: 1_234n,
    });
    await buildWithdrawIx(recordingProgram, {
      operator,
      agentDid,
      mint,
      destination: PublicKey.unique(),
      amount: 9_999n,
      priceFeed: customPriceFeed,
    });
    await buildInitStreamIx(recordingProgram, {
      client,
      agentDid,
      streamNonce,
      payerMint,
      payoutMint,
      clientTokenAccount,
      ratePerSec: 77n,
      maxDuration: 3_600n,
    });
    await buildCloseStreamIx(recordingProgram, {
      signer: client,
      stream,
      treasury,
      payerMint,
      agentDid,
      clientTokenAccount,
    });
    await buildWithdrawEarnedIx(recordingProgram, {
      operator,
      agentDid,
      stream,
      payerMint,
      payoutMint,
      jupiterProgram: customJupiterProgram,
      routeData: Uint8Array.from([1, 2, 3]),
    });
    await buildWithdrawEarnedIx(recordingProgram, {
      operator,
      agentDid,
      stream,
      payerMint,
      payoutMint,
      jupiterProgram: customJupiterProgram,
      routeData: Uint8Array.from([4, 5, 6]),
      payerPriceFeed: customPriceFeed,
      payoutPriceFeed: PublicKey.unique(),
      allowedTargets: customAllowedTargets,
      hookAllowlist: customHookAllowlist,
      agentHooks: customAgentHooks,
      tokenProgramId: customTokenProgram,
    });

    expect(calls.map((call) => call.method)).toEqual([
      'withdraw',
      'withdraw',
      'initStream',
      'closeStream',
      'withdrawEarned',
      'withdrawEarned',
    ]);

    expect(calls[0]?.args[0]).toMatchObject({ words: expect.any(Array) });
    expect(calls[0]?.accounts.priceFeed).toBeNull();
    expect(calls[1]?.accounts.priceFeed).toEqual(customPriceFeed);
    expect(calls[2]?.args[0]).toEqual(Array.from(streamNonce));
    expect(calls[2]?.accounts.rent).toEqual(new PublicKey('SysvarRent111111111111111111111111111111111'));
    expect(calls[3]?.accounts.treasury).toEqual(treasury);
    expect(calls[4]?.accounts.allowedTargets).toBeNull();
    expect(calls[4]?.accounts.hookAllowlist).toBeNull();
    expect(calls[4]?.accounts.agentHooks).toBeNull();
    expect((calls[4]?.accounts.tokenProgram as PublicKey).equals(new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'))).toBe(true);
    expect(calls[5]?.accounts.allowedTargets).toEqual(customAllowedTargets);
    expect(calls[5]?.accounts.hookAllowlist).toEqual(customHookAllowlist);
    expect(calls[5]?.accounts.agentHooks).toEqual(customAgentHooks);
    expect((calls[5]?.accounts.tokenProgram as PublicKey).equals(customTokenProgram)).toBe(true);
    expect(calls[5]?.args[0]).toEqual(Buffer.from([4, 5, 6]));
  });
});

describe('yield automation builders', () => {
  it('builds strategy registration with descriptor PDA and args', async () => {
    const strategyProgram = PublicKey.unique();
    const underlyingMint = PublicKey.unique();
    const receiptMint = PublicKey.unique();
    const ix = await buildRegisterYieldStrategyIx(program, {
      authority: operator,
      strategyId,
      venue: 'kamino',
      strategyProgram,
      underlyingMint,
      receiptMint,
      maxAllocationBps: 2_500,
      riskTier: 'conservative',
      name: 'Kamino USDC lend',
      metadataUri: 'ipfs://kamino-usdc',
    });

    expect(Array.from(ix.data.subarray(0, 8))).toEqual(expectedDiscriminator(idl as never, 'register_yield_strategy'));
    const [global] = treasuryGlobalPda(PROG);
    const [strategy] = treasuryYieldStrategyPda(PROG, strategyId);
    const keys = accountKeys(ix);
    expect(keys[0]).toBe(global.toBase58());
    expect(keys[1]).toBe(strategy.toBase58());
    expect(keys).toContain(SystemProgram.programId.toBase58());

    const decoded = decodeIx(idl as Record<string, unknown>, ix);
    expect(decoded.name).toBe('register_yield_strategy');
    expect((decoded.data as { venue: { Kamino: Record<string, never> } }).venue).toEqual({ Kamino: {} });
    expect((decoded.data as { max_allocation_bps: number }).max_allocation_bps).toBe(2_500);
  });

  it('builds config, unwind, status, and accounting instructions', async () => {
    const configIx = await buildSetTreasuryYieldConfigIx(program, {
      operator,
      agentDid,
      strategyId,
      allocationBps: 1_500,
    });
    const statusIx = await buildSetYieldStrategyStatusIx(program, {
      authority: operator,
      strategyId,
      status: 'paused',
    });
    const unwindIx = await buildRequestTreasuryYieldUnwindIx(program, { operator, agentDid });
    const accountingIx = await buildRecordTreasuryYieldAccountingIx(program, {
      authority: operator,
      agentDid,
      idleAmount: 1_000_000n,
      deployedAmount: 250_000n,
      realizedYieldAmount: 12_345n,
      accountingSlot: 99n,
    });

    const [treasury] = treasuryPda(PROG, agentDid);
    const [strategy] = treasuryYieldStrategyPda(PROG, strategyId);
    const [yieldConfig] = treasuryYieldConfigPda(PROG, agentDid);

    expect(accountKeys(configIx)).toEqual([
      treasuryGlobalPda(PROG)[0].toBase58(),
      treasury.toBase58(),
      strategy.toBase58(),
      yieldConfig.toBase58(),
      operator.toBase58(),
      SystemProgram.programId.toBase58(),
    ]);
    expect(decodeIx(idl as Record<string, unknown>, configIx).name).toBe('set_treasury_yield_config');
    expect(decodeIx(idl as Record<string, unknown>, statusIx).name).toBe('set_yield_strategy_status');
    expect(decodeIx(idl as Record<string, unknown>, unwindIx).name).toBe('request_treasury_yield_unwind');
    expect(decodeIx(idl as Record<string, unknown>, accountingIx).name).toBe('record_treasury_yield_accounting');
  });
});
