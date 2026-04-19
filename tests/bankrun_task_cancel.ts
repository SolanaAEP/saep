import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock, warpClockTo } from './helpers/bankrun';
import { padBytes } from './helpers/encoding';
import {
  createATA, createToken2022Mint, mintTokens, sendTx,
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
import type { TaskMarket } from '../target/types/task_market';

const PROGRAM_IDS = {
  capability_registry: new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F'),
  agent_registry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
  treasury_standard: new PublicKey('6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ'),
  task_market: new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w'),
  proof_verifier: new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe'),
  fee_collector: new PublicKey('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu'),
};

const MIN_STAKE = 1_000_000;
const PAYMENT_AMOUNT = 5_000_000;
const PROTOCOL_FEE_BPS = 100;
const SOLREP_FEE_BPS = 50;
const DISPUTE_WINDOW_SECS = 10;
const MAX_DEADLINE_SECS = 86_400 * 365;
const CANCEL_GRACE_SECS = 300;
const T0 = 1_700_000_000n;
const DEADLINE_A_OFFSET = 600;
const DEADLINE_B_OFFSET = 1_200;

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

const taskMarketPdas = {
  global: () => PublicKey.findProgramAddressSync(
    [Buffer.from('market_global')], PROGRAM_IDS.task_market,
  ),
  task: (client: PublicKey, nonce: Uint8Array) => PublicKey.findProgramAddressSync(
    [Buffer.from('task'), client.toBuffer(), Buffer.from(nonce)],
    PROGRAM_IDS.task_market,
  ),
  escrow: (task: PublicKey) => PublicKey.findProgramAddressSync(
    [Buffer.from('task_escrow'), task.toBuffer()], PROGRAM_IDS.task_market,
  ),
  bidBook: (taskId: Uint8Array) => PublicKey.findProgramAddressSync(
    [Buffer.from('bid_book'), Buffer.from(taskId)], PROGRAM_IDS.task_market,
  ),
  bondEscrow: (taskId: Uint8Array) => PublicKey.findProgramAddressSync(
    [Buffer.from('bond_escrow'), Buffer.from(taskId)], PROGRAM_IDS.task_market,
  ),
  guard: () => PublicKey.findProgramAddressSync(
    [Buffer.from('guard')], PROGRAM_IDS.task_market,
  ),
};

describe('bankrun: task_market — cancel CU coverage', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let capRegProgram: anchor.Program<CapabilityRegistry>;
  let agentRegProgram: anchor.Program<AgentRegistry>;
  let taskMarketProgram: anchor.Program<TaskMarket>;

  let authority: Keypair;
  const operator = Keypair.generate();
  const client = Keypair.generate();
  const mintAuthority = Keypair.generate();
  const solrepPool = Keypair.generate();

  let paymentMint: PublicKey;
  let stakeMint: PublicKey;
  let clientAta: PublicKey;
  let agentPda: PublicKey;
  let agentDid: Uint8Array;

  const agentId = Buffer.alloc(32, 0);
  agentId.write('cancel-test-agent', 'utf8');

  const nonceA = new Uint8Array(8);
  Buffer.from('cxu-001', 'utf8').copy(nonceA);
  const nonceB = new Uint8Array(8);
  Buffer.from('cxb-001', 'utf8').copy(nonceB);

  let taskA: PublicKey;
  let taskB: PublicKey;
  let taskBId: Uint8Array;

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const capRegIdl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/capability_registry.json'), 'utf8'));
    const agentRegIdl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/agent_registry.json'), 'utf8'));
    const taskMarketIdl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/task_market.json'), 'utf8'));

    capRegProgram = new anchor.Program<CapabilityRegistry>(capRegIdl, provider);
    agentRegProgram = new anchor.Program<AgentRegistry>(agentRegIdl, provider);
    taskMarketProgram = new anchor.Program<TaskMarket>(taskMarketIdl, provider);

    for (const kp of [operator, client, mintAuthority, solrepPool]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    paymentMint = await createToken2022Mint(context, authority, mintAuthority.publicKey, 6);
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
        new BN(86400),
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

    const operatorStakeAta = await createATA(context, authority, stakeMint, operator.publicKey);
    await mintTokens(context, authority, stakeMint, operatorStakeAta, mintAuthority, MIN_STAKE);

    const [capConfigPda] = capRegPdas.config();
    const [agentPdaLocal] = agentRegPdas.agent(operator.publicKey, agentId);
    const [stakePda] = agentRegPdas.stake(agentPdaLocal);
    const [arGuardPda] = agentRegPdas.guard();

    await agentRegProgram.methods
      .registerAgent(
        Array.from(agentId) as unknown as number[],
        padBytes('ipfs://agent-cancel-test', 128) as unknown as number[],
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
        operatorTokenAccount: operatorStakeAta,
        operator: operator.publicKey,
        personhoodAttestation: null,
        guard: arGuardPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    agentPda = agentPdaLocal;
    const agentAccount = await agentRegProgram.account.agentAccount.fetch(agentPda);
    agentDid = new Uint8Array(agentAccount.did);

    const allowedMints: PublicKey[] = Array(8).fill(PublicKey.default);
    allowedMints[0] = paymentMint;

    await taskMarketProgram.methods
      .initGlobal(
        authority.publicKey,
        PROGRAM_IDS.agent_registry,
        PROGRAM_IDS.treasury_standard,
        PROGRAM_IDS.proof_verifier,
        PROGRAM_IDS.fee_collector,
        solrepPool.publicKey,
        PROTOCOL_FEE_BPS,
        SOLREP_FEE_BPS,
        new BN(DISPUTE_WINDOW_SECS),
        new BN(MAX_DEADLINE_SECS),
        allowedMints as unknown as PublicKey[],
      )
      .accountsPartial({ payer: authority.publicKey })
      .rpc();

    const [marketGlobalPda] = taskMarketPdas.global();
    await taskMarketProgram.methods
      .initGuard([PROGRAM_IDS.task_market])
      .accountsPartial({
        global: marketGlobalPda,
        authority: authority.publicKey,
      })
      .rpc();

    clientAta = await createATA(context, authority, paymentMint, client.publicKey);
    await mintTokens(context, authority, paymentMint, clientAta, mintAuthority, PAYMENT_AMOUNT * 4);

    const [taskAPda] = taskMarketPdas.task(client.publicKey, nonceA);
    taskA = taskAPda;

    const payload = {
      kind: { generic: { capabilityBit: 0, argsHash: Array(32).fill(0) } },
      capabilityBit: 0,
      criteria: Buffer.alloc(0),
      requiresPersonhood: { none: {} },
    };

    const deadlineA = Number(T0) + DEADLINE_A_OFFSET;
    await taskMarketProgram.methods
      .createTask(
        Array.from(nonceA) as unknown as number[],
        Array.from(agentDid) as unknown as number[],
        paymentMint,
        new BN(PAYMENT_AMOUNT),
        payload,
        Array(32).fill(0) as unknown as number[],
        new BN(deadlineA),
        1,
      )
      .accountsPartial({
        global: marketGlobalPda,
        client: client.publicKey,
        agentRegistryProgram: PROGRAM_IDS.agent_registry,
        registryGlobal: regGlobalPda,
        agentAccount: agentPda,
      })
      .signers([client])
      .rpc();
  });

  it('program id matches Anchor.toml', () => {
    expect(taskMarketProgram.programId.toBase58()).to.equal(
      PROGRAM_IDS.task_market.toBase58(),
    );
  });

  it('cancel_unfunded_task rejects pre-grace (GraceNotElapsed)', async () => {
    await warpClockTo(context, T0 + 60n);

    let rejected = false;
    try {
      await taskMarketProgram.methods
        .cancelUnfundedTask()
        .accountsPartial({
          task: taskA,
          client: client.publicKey,
        })
        .signers([client])
        .rpc();
    } catch (e) {
      rejected = true;
      expect(String(e)).to.match(/GraceNotElapsed/);
    }
    expect(rejected).to.equal(true);
  });

  it('cancel_unfunded_task closes task post-grace and refunds rent', async () => {
    await warpClockTo(context, T0 + BigInt(CANCEL_GRACE_SECS + 1));

    const clientLamportsBefore = (await context.banksClient.getAccount(client.publicKey))!.lamports;
    const taskAcctBefore = await context.banksClient.getAccount(taskA);
    expect(taskAcctBefore).to.not.equal(null);

    await taskMarketProgram.methods
      .cancelUnfundedTask()
      .accountsPartial({
        task: taskA,
        client: client.publicKey,
      })
      .signers([client])
      .rpc();

    const taskAcctAfter = await context.banksClient.getAccount(taskA);
    expect(taskAcctAfter).to.equal(null);

    const clientLamportsAfter = (await context.banksClient.getAccount(client.publicKey))!.lamports;
    expect(clientLamportsAfter).to.be.greaterThan(clientLamportsBefore);
  });

  it('cancel_bidding closes empty bid_book in commit phase', async () => {
    const [marketGlobalPda] = taskMarketPdas.global();
    const [regGlobalPda] = agentRegPdas.global();
    const [taskBPda] = taskMarketPdas.task(client.publicKey, nonceB);
    taskB = taskBPda;

    const payload = {
      kind: { generic: { capabilityBit: 0, argsHash: Array(32).fill(0) } },
      capabilityBit: 0,
      criteria: Buffer.alloc(0),
      requiresPersonhood: { none: {} },
    };

    const now = (await context.banksClient.getClock()).unixTimestamp;
    const deadlineB = Number(now) + DEADLINE_B_OFFSET;
    await taskMarketProgram.methods
      .createTask(
        Array.from(nonceB) as unknown as number[],
        Array.from(agentDid) as unknown as number[],
        paymentMint,
        new BN(PAYMENT_AMOUNT),
        payload,
        Array(32).fill(0) as unknown as number[],
        new BN(deadlineB),
        1,
      )
      .accountsPartial({
        global: marketGlobalPda,
        client: client.publicKey,
        agentRegistryProgram: PROGRAM_IDS.agent_registry,
        registryGlobal: regGlobalPda,
        agentAccount: agentPda,
      })
      .signers([client])
      .rpc();

    const [escrowBPda] = taskMarketPdas.escrow(taskB);
    const [tmGuardPda] = taskMarketPdas.guard();

    await taskMarketProgram.methods
      .fundTask()
      .accountsPartial({
        global: marketGlobalPda,
        task: taskB,
        paymentMint,
        escrow: escrowBPda,
        clientTokenAccount: clientAta,
        hookAllowlist: null,
        guard: tmGuardPda,
        client: client.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    const fundedTask = await taskMarketProgram.account.taskContract.fetch(taskB);
    taskBId = new Uint8Array(fundedTask.taskId);

    const [bidBookPda] = taskMarketPdas.bidBook(taskBId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskBId);

    await taskMarketProgram.methods
      .openBidding(new BN(120), new BN(120), 100)
      .accountsPartial({
        global: marketGlobalPda,
        task: taskB,
        bidBook: bidBookPda,
        paymentMint,
        bondEscrow: bondEscrowPda,
        client: client.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    const bookBefore = await taskMarketProgram.account.bidBook.fetch(bidBookPda);
    expect(bookBefore.commitCount).to.equal(0);
    expect(bookBefore.phase).to.deep.include({ commit: {} });

    await taskMarketProgram.methods
      .cancelBidding()
      .accountsPartial({
        task: taskB,
        bidBook: bidBookPda,
        paymentMint,
        bondEscrow: bondEscrowPda,
        client: client.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    const bidBookAfter = await context.banksClient.getAccount(bidBookPda);
    expect(bidBookAfter).to.equal(null);
    const bondEscrowAfter = await context.banksClient.getAccount(bondEscrowPda);
    expect(bondEscrowAfter).to.equal(null);

    const taskAfter = await taskMarketProgram.account.taskContract.fetch(taskB);
    expect(taskAfter.bidBook).to.equal(null);
  });
});
