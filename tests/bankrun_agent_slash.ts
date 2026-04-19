import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock, warpClockBy } from './helpers/bankrun';
import { padBytes } from './helpers/encoding';
import {
  createATA, createToken2022Mint, getTokenBalance, mintTokens, sendTx,
} from './helpers/token';
import {
  Keypair, PublicKey, SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
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
const STAKE_INCREASE = 500_000;
const TOTAL_STAKE = MIN_STAKE + STAKE_INCREASE;
const MAX_SLASH_BPS = 1000;
const SLASH_CAP = Math.floor((TOTAL_STAKE * MAX_SLASH_BPS) / 10_000);
const SLASH_AMOUNT = SLASH_CAP;
const SLASH_TIMELOCK_SECS = 10;
const INITIAL_BALANCE = 10_000_000;
const T0 = 1_700_000_000n;

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

describe('bankrun: agent_registry — slash 30d timelock + bps cap', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let capRegProgram: anchor.Program<CapabilityRegistry>;
  let agentRegProgram: anchor.Program<AgentRegistry>;

  let authority: Keypair;
  const operator = Keypair.generate();
  const mintAuthority = Keypair.generate();
  const slashingAuthority = Keypair.generate();

  let stakeMint: PublicKey;
  let operatorAta: PublicKey;
  let slashingTreasuryAta: PublicKey;
  let agentPda: PublicKey;
  let stakeVaultPda: PublicKey;

  const agentId = Buffer.alloc(32, 0);
  agentId.write('slash-test-agent', 'utf8');

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const capRegIdl = JSON.parse(readFileSync(resolve(process.cwd(), 'target/idl/capability_registry.json'), 'utf8'));
    const agentRegIdl = JSON.parse(readFileSync(resolve(process.cwd(), 'target/idl/agent_registry.json'), 'utf8'));

    capRegProgram = new anchor.Program<CapabilityRegistry>(capRegIdl, provider);
    agentRegProgram = new anchor.Program<AgentRegistry>(agentRegIdl, provider);

    for (const kp of [operator, mintAuthority, slashingAuthority]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    stakeMint = await createToken2022Mint(context, authority, mintAuthority.publicKey, 6);
    slashingTreasuryAta = await createATA(context, authority, stakeMint, slashingAuthority.publicKey);

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
        slashingTreasuryAta,
        stakeMint,
        PROGRAM_IDS.proof_verifier,
        new BN(MIN_STAKE),
        MAX_SLASH_BPS,
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
        padBytes('ipfs://agent-slash-test', 128) as unknown as number[],
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

    await agentRegProgram.methods
      .stakeIncrease(new BN(STAKE_INCREASE))
      .accountsPartial({
        global: regGlobalPda,
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
  });

  it('propose_slash at 10% cap populates pending_slash with 30d executable_at', async () => {
    const reasonCode = 42;
    await agentRegProgram.methods
      .proposeSlash(new BN(SLASH_AMOUNT), reasonCode)
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const agent = await agentRegProgram.account.agentAccount.fetch(agentPda);
    expect(agent.pendingSlash).to.not.equal(null);
    expect(agent.pendingSlash!.amount.toNumber()).to.equal(SLASH_AMOUNT);
    expect(agent.pendingSlash!.reasonCode).to.equal(reasonCode);
    expect(agent.pendingSlash!.proposer.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(agent.pendingSlash!.executableAt.toNumber() - agent.pendingSlash!.proposedAt.toNumber())
      .to.equal(SLASH_TIMELOCK_SECS);
  });

  it('execute_slash pre-timelock rejects with TimelockNotElapsed', async () => {
    const [guardPda] = agentRegPdas.guard();
    let err: unknown;
    try {
      await agentRegProgram.methods
        .executeSlash()
        .accountsPartial({
          global: agentRegPdas.global()[0],
          agent: agentPda,
          stakeMint,
          stakeVault: stakeVaultPda,
          slashingTreasury: slashingTreasuryAta,
          cranker: authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/TimelockNotElapsed/);
  });

  it('cancel_slash clears pending_slash so we can re-propose', async () => {
    await agentRegProgram.methods
      .cancelSlash()
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const cleared = await agentRegProgram.account.agentAccount.fetch(agentPda);
    expect(cleared.pendingSlash).to.equal(null);

    await agentRegProgram.methods
      .proposeSlash(new BN(SLASH_AMOUNT), 42)
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const reproposed = await agentRegProgram.account.agentAccount.fetch(agentPda);
    expect(reproposed.pendingSlash).to.not.equal(null);
  });

  it('propose_slash over 10% cap rejects with SlashBoundExceeded', async () => {
    // Advance one slot so this cancel_slash's recent_blockhash differs from
    // the prior test's cancel_slash — identical signer + accounts + ix data
    // would otherwise produce the same tx sig and trip bankrun dedup.
    await warpClockBy(context, 1n);
    await agentRegProgram.methods
      .cancelSlash()
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    let err: unknown;
    try {
      await agentRegProgram.methods
        .proposeSlash(new BN(SLASH_CAP + 1), 42)
        .accountsPartial({
          global: agentRegPdas.global()[0],
          agent: agentPda,
          authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    } catch (e) {
      err = e;
    }
    expect(String(err)).to.match(/SlashBoundExceeded/);

    await agentRegProgram.methods
      .proposeSlash(new BN(SLASH_AMOUNT), 42)
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  });

  it('warp past timelock → execute_slash transfers amount + clears pending', async () => {
    await warpClockBy(context, BigInt(SLASH_TIMELOCK_SECS + 1));

    const vaultBefore = await getTokenBalance(context, stakeVaultPda);
    const treasuryBefore = await getTokenBalance(context, slashingTreasuryAta);
    const agentBefore = await agentRegProgram.account.agentAccount.fetch(agentPda);
    const stakeBefore = agentBefore.stakeAmount.toNumber();

    await agentRegProgram.methods
      .executeSlash()
      .accountsPartial({
        global: agentRegPdas.global()[0],
        agent: agentPda,
        stakeMint,
        stakeVault: stakeVaultPda,
        slashingTreasury: slashingTreasuryAta,
        cranker: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([authority])
      .rpc();

    const agent = await agentRegProgram.account.agentAccount.fetch(agentPda);
    expect(agent.pendingSlash).to.equal(null);
    expect(agent.stakeAmount.toNumber()).to.equal(stakeBefore - SLASH_AMOUNT);

    const vaultAfter = await getTokenBalance(context, stakeVaultPda);
    const treasuryAfter = await getTokenBalance(context, slashingTreasuryAta);
    expect(Number(vaultBefore - vaultAfter)).to.equal(SLASH_AMOUNT);
    expect(Number(treasuryAfter - treasuryBefore)).to.equal(SLASH_AMOUNT);
  });
});
