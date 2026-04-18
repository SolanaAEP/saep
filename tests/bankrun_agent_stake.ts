import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { Clock, ProgramTestContext } from 'solana-bankrun';
import {
  Keypair, PublicKey, SystemProgram, Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { CapabilityRegistry } from '../target/types/capability_registry';
import type { AgentRegistry } from '../target/types/agent_registry';

const PROGRAM_IDS = {
  capability_registry: new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F'),
  agent_registry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
  task_market: new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w'),
  proof_verifier: new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe'),
};

const MIN_STAKE = 1_000_000;
const SLASH_TIMELOCK_SECS = 10;
const INITIAL_BALANCE = 10_000_000;
const T0 = 1_700_000_000n;

function padBytes(s: string, len: number): number[] {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

async function setClock(ctx: ProgramTestContext, unixTimestamp: bigint): Promise<void> {
  const current = await ctx.banksClient.getClock();
  ctx.setClock(new Clock(
    current.slot,
    current.epochStartTimestamp,
    current.epoch,
    current.leaderScheduleEpoch,
    unixTimestamp,
  ));
}

async function advanceClock(ctx: ProgramTestContext, deltaSecs: bigint): Promise<void> {
  const current = await ctx.banksClient.getClock();
  const nextSlot = current.slot + 1n;
  ctx.warpToSlot(nextSlot);
  ctx.setClock(new Clock(
    nextSlot,
    current.epochStartTimestamp,
    current.epoch,
    current.leaderScheduleEpoch,
    current.unixTimestamp + deltaSecs,
  ));
}

async function sendTx(
  ctx: ProgramTestContext,
  tx: Transaction,
  signers: Keypair[],
): Promise<void> {
  tx.recentBlockhash = ctx.lastBlockhash;
  tx.feePayer = signers[0]!.publicKey;
  tx.sign(...signers);
  await ctx.banksClient.processTransaction(tx);
}

async function createToken2022Mint(
  ctx: ProgramTestContext,
  payer: Keypair,
  mintAuthority: PublicKey,
  decimals: number,
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();
  const space = getMintLen([]);
  const rent = await ctx.banksClient.getRent();
  const lamports = Number(rent.minimumBalance(BigInt(space)));
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mintKeypair.publicKey, decimals, mintAuthority, null, TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendTx(ctx, tx, [payer, mintKeypair]);
  return mintKeypair.publicKey;
}

async function createATA(
  ctx: ProgramTestContext,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID,
    ),
  );
  await sendTx(ctx, tx, [payer]);
  return ata;
}

async function mintTokens(
  ctx: ProgramTestContext,
  payer: Keypair,
  mint: PublicKey,
  dest: PublicKey,
  authority: Keypair,
  amount: number,
): Promise<void> {
  const tx = new Transaction().add(
    createMintToInstruction(mint, dest, authority.publicKey, amount, [], TOKEN_2022_PROGRAM_ID),
  );
  await sendTx(ctx, tx, [payer, authority]);
}

async function getTokenBalance(ctx: ProgramTestContext, ata: PublicKey): Promise<bigint> {
  const acct = await ctx.banksClient.getAccount(ata);
  if (!acct) return 0n;
  return Buffer.from(acct.data).readBigUInt64LE(64);
}

const capRegPdas = {
  config: () => PublicKey.findProgramAddressSync(
    [Buffer.from('config')], PROGRAM_IDS.capability_registry,
  ),
  tag: (bit: number) => PublicKey.findProgramAddressSync(
    [Buffer.from('tag'), Buffer.from([bit])], PROGRAM_IDS.capability_registry,
  ),
};

const agentRegPdas = {
  global: () => PublicKey.findProgramAddressSync(
    [Buffer.from('global')], PROGRAM_IDS.agent_registry,
  ),
  agent: (operator: PublicKey, agentId: Uint8Array) => PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), operator.toBuffer(), Buffer.from(agentId)],
    PROGRAM_IDS.agent_registry,
  ),
  stake: (agent: PublicKey) => PublicKey.findProgramAddressSync(
    [Buffer.from('stake'), agent.toBuffer()], PROGRAM_IDS.agent_registry,
  ),
  guard: () => PublicKey.findProgramAddressSync(
    [Buffer.from('guard')], PROGRAM_IDS.agent_registry,
  ),
};

describe('bankrun: agent_registry — stake_increase + stake_withdraw CU coverage', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let capRegProgram: anchor.Program<CapabilityRegistry>;
  let agentRegProgram: anchor.Program<AgentRegistry>;

  let authority: Keypair;
  const operator = Keypair.generate();
  const mintAuthority = Keypair.generate();

  let stakeMint: PublicKey;
  let operatorAta: PublicKey;
  let agentPda: PublicKey;
  let stakeVaultPda: PublicKey;

  const agentId = Buffer.alloc(32, 0);
  agentId.write('stake-test-agent', 'utf8');

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const capRegIdl = JSON.parse(readFileSync(resolve(process.cwd(), 'target/idl/capability_registry.json'), 'utf8'));
    const agentRegIdl = JSON.parse(readFileSync(resolve(process.cwd(), 'target/idl/agent_registry.json'), 'utf8'));

    capRegProgram = new anchor.Program<CapabilityRegistry>(capRegIdl, provider);
    agentRegProgram = new anchor.Program<AgentRegistry>(agentRegIdl, provider);

    for (const kp of [operator, mintAuthority]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setClock(context, T0);

    stakeMint = await createToken2022Mint(context, authority, mintAuthority.publicKey, 6);

    await capRegProgram.methods
      .initialize(authority.publicKey)
      .accountsPartial({ payer: authority.publicKey })
      .rpc();

    const [tagPda] = capRegPdas.tag(0);
    await capRegProgram.methods
      .proposeTag(
        0,
        padBytes('general_compute', 32) as unknown as number[],
        padBytes('ipfs://capability/general-compute', 96) as unknown as number[],
      )
      .accountsPartial({
        tag: tagPda,
        authority: authority.publicKey,
        payer: authority.publicKey,
      })
      .rpc();

    await agentRegProgram.methods
      .initGlobal(
        authority.publicKey,
        PROGRAM_IDS.capability_registry,
        PROGRAM_IDS.task_market,
        PublicKey.default,
        PublicKey.default,
        stakeMint,
        PROGRAM_IDS.proof_verifier,
        new BN(MIN_STAKE),
        1000,
        new BN(SLASH_TIMELOCK_SECS),
      )
      .accountsPartial({ payer: authority.publicKey, stakeMintInfo: stakeMint })
      .rpc();

    const [regGlobalPda] = agentRegPdas.global();
    await agentRegProgram.methods
      .initGuard([PROGRAM_IDS.agent_registry])
      .accountsPartial({
        global: regGlobalPda,
        authority: authority.publicKey,
      })
      .rpc();

    operatorAta = await createATA(context, authority, stakeMint, operator.publicKey);
    await mintTokens(context, authority, stakeMint, operatorAta, mintAuthority, INITIAL_BALANCE);

    const [capConfigPda] = capRegPdas.config();
    const [agentPdaLocal] = agentRegPdas.agent(operator.publicKey, agentId);
    const [stakePda] = agentRegPdas.stake(agentPdaLocal);
    const [guardPda] = agentRegPdas.guard();

    await agentRegProgram.methods
      .registerAgent(
        Array.from(agentId) as unknown as number[],
        padBytes('ipfs://agent-stake-test', 128) as unknown as number[],
        new BN(1),
        new BN(1_000_000),
        new BN(100),
        new BN(MIN_STAKE),
      )
      .accountsPartial({
        global: regGlobalPda,
        capabilityConfig: capConfigPda,
        stakeMint,
        stakeVault: stakePda,
        operatorTokenAccount: operatorAta,
        operator: operator.publicKey,
        personhoodAttestation: null,
        guard: guardPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    agentPda = agentPdaLocal;
    stakeVaultPda = stakePda;
  });

  it('program id matches Anchor.toml', () => {
    expect(agentRegProgram.programId.toBase58()).to.equal(
      PROGRAM_IDS.agent_registry.toBase58(),
    );
  });

  it('stake_increase adds to stake_amount + transfers tokens', async () => {
    const addAmount = 500_000;
    const [guardPda] = agentRegPdas.guard();
    const vaultBefore = await getTokenBalance(context, stakeVaultPda);
    const opBefore = await getTokenBalance(context, operatorAta);

    await agentRegProgram.methods
      .stakeIncrease(new BN(addAmount))
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        stakeMint,
        stakeVault: stakeVaultPda,
        operatorTokenAccount: operatorAta,
        guard: guardPda,
        operator: operator.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    const agent = await agentRegProgram.account.agentAccount.fetch(agentPda);
    expect(agent.stakeAmount.toNumber()).to.equal(MIN_STAKE + addAmount);

    const vaultAfter = await getTokenBalance(context, stakeVaultPda);
    const opAfter = await getTokenBalance(context, operatorAta);
    expect(Number(vaultAfter - vaultBefore)).to.equal(addAmount);
    expect(Number(opBefore - opAfter)).to.equal(addAmount);
  });

  it('stake_increase(0) rejects via ArithmeticOverflow guard', async () => {
    const [guardPda] = agentRegPdas.guard();
    let err: unknown;
    try {
      await agentRegProgram.methods
        .stakeIncrease(new BN(0))
        .accountsPartial({
          global: agentRegPdas.global()[0],
          agent: agentPda,
          stakeMint,
          stakeVault: stakeVaultPda,
          operatorTokenAccount: operatorAta,
          guard: guardPda,
          operator: operator.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([operator])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/ArithmeticOverflow/);
  });

  it('stake_withdraw_request → warp past timelock → stake_withdraw_execute', async () => {
    const withdrawAmount = 400_000;
    const [guardPda] = agentRegPdas.guard();

    await agentRegProgram.methods
      .stakeWithdrawRequest(new BN(withdrawAmount))
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        operator: operator.publicKey,
      })
      .signers([operator])
      .rpc();

    const afterRequest = await agentRegProgram.account.agentAccount.fetch(agentPda);
    expect(afterRequest.pendingWithdrawal).to.not.equal(null);
    expect(afterRequest.pendingWithdrawal!.amount.toNumber()).to.equal(withdrawAmount);

    let preTimelockErr: unknown;
    try {
      await agentRegProgram.methods
        .stakeWithdrawExecute()
        .accountsPartial({
          global: agentRegPdas.global()[0],
          agent: agentPda,
          stakeMint,
          stakeVault: stakeVaultPda,
          operatorTokenAccount: operatorAta,
          guard: guardPda,
          operator: operator.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([operator])
        .rpc();
    } catch (e) {
      preTimelockErr = e;
    }
    expect(String(preTimelockErr)).to.match(/TimelockNotElapsed/);

    await advanceClock(context, BigInt(SLASH_TIMELOCK_SECS + 1));

    const vaultBefore = await getTokenBalance(context, stakeVaultPda);
    const opBefore = await getTokenBalance(context, operatorAta);

    await agentRegProgram.methods
      .stakeWithdrawExecute()
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        stakeMint,
        stakeVault: stakeVaultPda,
        operatorTokenAccount: operatorAta,
        guard: guardPda,
        operator: operator.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    const afterExec = await agentRegProgram.account.agentAccount.fetch(agentPda);
    expect(afterExec.pendingWithdrawal).to.equal(null);
    expect(afterExec.stakeAmount.toNumber()).to.equal(MIN_STAKE + 500_000 - withdrawAmount);

    const vaultAfter = await getTokenBalance(context, stakeVaultPda);
    const opAfter = await getTokenBalance(context, operatorAta);
    expect(Number(vaultBefore - vaultAfter)).to.equal(withdrawAmount);
    expect(Number(opAfter - opBefore)).to.equal(withdrawAmount);
  });
});
