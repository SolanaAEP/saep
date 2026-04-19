import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { Clock, ProgramTestContext } from 'solana-bankrun';
import {
  createATA, createMint, getTokenBalance, mintTokens, sendTx,
} from './helpers/token';
import {
  Keypair, PublicKey, SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const jsSha3 = _require('js-sha3');

import type { CapabilityRegistry } from '../target/types/capability_registry';
import type { AgentRegistry } from '../target/types/agent_registry';
import type { TaskMarket } from '../target/types/task_market';

// Constants
const PROGRAM_IDS = {
  capability_registry: new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F'),
  agent_registry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
  task_market: new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w'),
  proof_verifier: new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe'),
  treasury_standard: new PublicKey('6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ'),
  fee_collector: new PublicKey('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu'),
};

const DISPUTE_WINDOW_SECS = 10;
const MAX_DEADLINE_SECS = 86_400 * 365;
const PAYMENT_AMOUNT = 10_000_000;
const PROTOCOL_FEE_BPS = 100;
const SOLREP_FEE_BPS = 50;
const MIN_STAKE = 1_000_000;
const DEADLINE = 1_800_000_000;
const BOND_BPS = 100;
const COMMIT_SECS = 300;
const REVEAL_SECS = 180;

const T0 = 1_700_000_000n;

// Helpers — parameterised by token program
function padBytes(s: string, len: number): number[] {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

async function setClock(ctx: ProgramTestContext, unixTimestamp: bigint) {
  const current = await ctx.banksClient.getClock();
  ctx.setClock(new Clock(
    current.slot,
    current.epochStartTimestamp,
    current.epoch,
    current.leaderScheduleEpoch,
    unixTimestamp,
  ));
}

function computeCommitHash(amount: bigint, nonce: Uint8Array, agentDid: Uint8Array): number[] {
  const amountLe = new Uint8Array(8);
  new DataView(amountLe.buffer).setBigUint64(0, amount, true);
  const buf = Buffer.concat([
    Buffer.from(amountLe),
    Buffer.from(nonce),
    Buffer.from(agentDid),
  ]);
  const hash = jsSha3.keccak_256.arrayBuffer(buf);
  return Array.from(new Uint8Array(hash));
}

// PDA helpers
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
  bid: (taskId: Uint8Array, bidder: PublicKey) => PublicKey.findProgramAddressSync(
    [Buffer.from('bid'), Buffer.from(taskId), bidder.toBuffer()], PROGRAM_IDS.task_market,
  ),
  bondEscrow: (taskId: Uint8Array) => PublicKey.findProgramAddressSync(
    [Buffer.from('bond_escrow'), Buffer.from(taskId)], PROGRAM_IDS.task_market,
  ),
  guard: () => PublicKey.findProgramAddressSync(
    [Buffer.from('guard')], PROGRAM_IDS.task_market,
  ),
};

// SPL Token compat test — full commit-reveal lifecycle with TOKEN_PROGRAM_ID
describe('task_market SPL Token compat (bankrun)', function () {
  this.timeout(120_000);

  // Payment uses legacy SPL Token, staking still uses Token-2022
  const PAYMENT_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
  const STAKE_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

  let context: ProgramTestContext;
  let provider: BankrunProvider;

  let capRegProgram: anchor.Program<CapabilityRegistry>;
  let agentRegProgram: anchor.Program<AgentRegistry>;
  let taskMarketProgram: anchor.Program<TaskMarket>;

  let authority: Keypair;
  const client = Keypair.generate();
  const mintAuthority = Keypair.generate();
  const feeCollector = Keypair.generate();
  const solrepPool = Keypair.generate();

  const operators = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

  let paymentMint: PublicKey;
  let stakeMint: PublicKey;
  const taskNonce = new Uint8Array(8).fill(99);

  const agentIds = operators.map((_, i) => {
    const buf = Buffer.alloc(32, 0);
    buf.write(`spl-agent-${i}`, 'utf8');
    return buf;
  });

  let agentDids: Uint8Array[] = [];
  let agentPdas: PublicKey[] = [];
  let taskPda: PublicKey;
  let taskId: Uint8Array;

  const bidAmounts = [500_000n, 300_000n, 700_000n];
  const nonces = [
    new Uint8Array(32).fill(44),
    new Uint8Array(32).fill(55),
    new Uint8Array(32).fill(66),
  ];

  const expectedBond = 100_000;

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const capRegIdl = JSON.parse(readFileSync(resolve(process.cwd(), 'target/idl/capability_registry.json'), 'utf8'));
    const agentRegIdl = JSON.parse(readFileSync(resolve(process.cwd(), 'target/idl/agent_registry.json'), 'utf8'));
    const taskMarketIdl = JSON.parse(readFileSync(resolve(process.cwd(), 'target/idl/task_market.json'), 'utf8'));

    capRegProgram = new anchor.Program<CapabilityRegistry>(capRegIdl, provider);
    agentRegProgram = new anchor.Program<AgentRegistry>(agentRegIdl, provider);
    taskMarketProgram = new anchor.Program<TaskMarket>(taskMarketIdl, provider);

    for (const kp of [client, feeCollector, solrepPool, mintAuthority, ...operators]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setClock(context, T0);

    // Payment mint: legacy SPL Token (the thing we're testing)
    paymentMint = await createMint(context, authority, mintAuthority.publicKey, 6, PAYMENT_TOKEN_PROGRAM);
    // Stake mint: still Token-2022 (agent_registry uses it independently)
    stakeMint = await createMint(context, authority, mintAuthority.publicKey, 6, STAKE_TOKEN_PROGRAM);

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

    // Register 3 agents (staking uses Token-2022)
    const [capConfigPda] = capRegPdas.config();
    const agentRegGuardPda = PublicKey.findProgramAddressSync(
      [Buffer.from('guard')], PROGRAM_IDS.agent_registry,
    )[0];

    for (let i = 0; i < 3; i++) {
      const op = operators[i]!;
      const agentId = agentIds[i]!;
      const operatorStakeAta = await createATA(context, authority, stakeMint, op.publicKey, STAKE_TOKEN_PROGRAM);
      await mintTokens(context, authority, stakeMint, operatorStakeAta, mintAuthority, MIN_STAKE, STAKE_TOKEN_PROGRAM);

      const [agentPda] = agentRegPdas.agent(op.publicKey, agentId);
      const [stakePda] = agentRegPdas.stake(agentPda);

      await agentRegProgram.methods
        .registerAgent(
          Array.from(agentId) as unknown as number[],
          padBytes(`ipfs://spl-agent-${i}`, 128) as unknown as number[],
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
          operator: op.publicKey,
          personhoodAttestation: null,
          guard: agentRegGuardPda,
          tokenProgram: STAKE_TOKEN_PROGRAM,
        })
        .signers([op])
        .rpc();

      agentPdas.push(agentPda);
      const agentAccount = await agentRegProgram.account.agentAccount.fetch(agentPda);
      agentDids.push(new Uint8Array(agentAccount.did as unknown as Uint8Array));
    }

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

    const [marketGlobal] = taskMarketPdas.global();
    await taskMarketProgram.methods
      .initGuard([PROGRAM_IDS.task_market])
      .accountsPartial({
        global: marketGlobal,
        authority: authority.publicKey,
      })
      .rpc();

    // Create client payment ATA with legacy SPL Token
    const clientPaymentAta = await createATA(context, authority, paymentMint, client.publicKey, PAYMENT_TOKEN_PROGRAM);
    await mintTokens(
      context, authority, paymentMint, clientPaymentAta, mintAuthority, PAYMENT_AMOUNT * 10, PAYMENT_TOKEN_PROGRAM,
    );

    for (const op of operators) {
      const ata = await createATA(context, authority, paymentMint, op.publicKey, PAYMENT_TOKEN_PROGRAM);
      await mintTokens(context, authority, paymentMint, ata, mintAuthority, expectedBond * 10, PAYMENT_TOKEN_PROGRAM);
    }

    await createATA(context, authority, paymentMint, feeCollector.publicKey, PAYMENT_TOKEN_PROGRAM);

    await setClock(context, 1_798_000_000n);

    const [marketGlobalPda] = taskMarketPdas.global();
    const [regGlobal] = agentRegPdas.global();
    const [taskPdaLocal] = taskMarketPdas.task(client.publicKey, taskNonce);
    taskPda = taskPdaLocal;

    const taskPayload = {
      kind: { generic: { capabilityBit: 0, argsHash: Array(32).fill(0) } },
      capabilityBit: 0,
      criteria: Buffer.alloc(0),
      requiresPersonhood: { none: {} },
    };

    await taskMarketProgram.methods
      .createTask(
        Array.from(taskNonce) as unknown as number[],
        Array.from(agentDids[0]!) as unknown as number[],
        paymentMint,
        new BN(PAYMENT_AMOUNT),
        taskPayload,
        Array(32).fill(0) as unknown as number[],
        new BN(DEADLINE),
        1,
      )
      .accountsPartial({
        global: marketGlobalPda,
        client: client.publicKey,
        agentRegistryProgram: PROGRAM_IDS.agent_registry,
        registryGlobal: regGlobal,
        agentAccount: agentPdas[0]!,
      })
      .signers([client])
      .rpc();

    // Fund task — passing TOKEN_PROGRAM_ID (SPL Token)
    const clientAta = getAssociatedTokenAddressSync(
      paymentMint, client.publicKey, true, PAYMENT_TOKEN_PROGRAM,
    );
    const [escrowPda] = taskMarketPdas.escrow(taskPda);
    const [guardPda] = taskMarketPdas.guard();

    await taskMarketProgram.methods
      .fundTask()
      .accountsPartial({
        global: marketGlobalPda,
        task: taskPda,
        paymentMint,
        escrow: escrowPda,
        clientTokenAccount: clientAta,
        hookAllowlist: null,
        guard: guardPda,
        client: client.publicKey,
        tokenProgram: PAYMENT_TOKEN_PROGRAM,
      })
      .signers([client])
      .rpc();

    const taskAccount = await taskMarketProgram.account.taskContract.fetch(taskPda);
    taskId = new Uint8Array(taskAccount.taskId as unknown as Uint8Array);
  });

  it('funds task with SPL Token mint (not Token-2022)', async () => {
    const [escrowPda] = taskMarketPdas.escrow(taskPda);
    const balance = await getTokenBalance(context, escrowPda);
    expect(Number(balance)).to.equal(PAYMENT_AMOUNT);
  });

  it('opens bidding with SPL Token bond escrow', async () => {
    const [marketGlobal] = taskMarketPdas.global();
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);

    await taskMarketProgram.methods
      .openBidding(new BN(COMMIT_SECS), new BN(REVEAL_SECS), BOND_BPS)
      .accountsPartial({
        global: marketGlobal,
        task: taskPda,
        bidBook: bidBookPda,
        paymentMint,
        bondEscrow: bondEscrowPda,
        client: client.publicKey,
        tokenProgram: PAYMENT_TOKEN_PROGRAM,
      })
      .signers([client])
      .rpc();

    const book = await taskMarketProgram.account.bidBook.fetch(bidBookPda);
    expect(book.bondAmount.toNumber()).to.equal(expectedBond);
    expect(book.phase).to.deep.include({ commit: {} });
  });

  it('3 agents commit bids with SPL Token bond transfers', async () => {
    const [marketGlobal] = taskMarketPdas.global();
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);
    const [regGlobal] = agentRegPdas.global();

    for (let i = 0; i < 3; i++) {
      const op = operators[i]!;
      const agentDid = agentDids[i]!;
      const commitHash = computeCommitHash(bidAmounts[i]!, nonces[i]!, agentDid);

      const bidderAta = getAssociatedTokenAddressSync(
        paymentMint, op.publicKey, true, PAYMENT_TOKEN_PROGRAM,
      );
      const [bidPda] = taskMarketPdas.bid(taskId, op.publicKey);

      await taskMarketProgram.methods
        .commitBid(
          commitHash as unknown as number[],
          Array.from(agentDid) as unknown as number[],
        )
        .accountsPartial({
          global: marketGlobal,
          task: taskPda,
          bidBook: bidBookPda,
          bid: bidPda,
          paymentMint,
          bondEscrow: bondEscrowPda,
          bidderTokenAccount: bidderAta,
          bidder: op.publicKey,
          agentRegistryProgram: PROGRAM_IDS.agent_registry,
          registryGlobal: regGlobal,
          agentAccount: agentPdas[i]!,
          personhoodAttestation: null,
          capabilityTag: null,
          hookAllowlist: null,
          tokenProgram: PAYMENT_TOKEN_PROGRAM,
        })
        .signers([op])
        .rpc();
    }

    const book = await taskMarketProgram.account.bidBook.fetch(bidBookPda);
    expect(book.commitCount).to.equal(3);

    const [bondEscrowPda2] = taskMarketPdas.bondEscrow(taskId);
    const escrowBalance = await getTokenBalance(context, bondEscrowPda2);
    expect(Number(escrowBalance)).to.equal(expectedBond * 3);
  });

  it('reveal and close_bidding picks lowest bid', async () => {
    await setClock(context, 1_798_000_000n + BigInt(COMMIT_SECS) + 1n);

    for (let i = 0; i < 3; i++) {
      const op = operators[i]!;
      const [bidPda] = taskMarketPdas.bid(taskId, op.publicKey);
      const [bidBookPda] = taskMarketPdas.bidBook(taskId);

      await taskMarketProgram.methods
        .revealBid(new BN(Number(bidAmounts[i]!)), Array.from(nonces[i]!) as unknown as number[])
        .accountsPartial({
          task: taskPda,
          bidBook: bidBookPda,
          bid: bidPda,
          bidder: op.publicKey,
        })
        .signers([op])
        .rpc();
    }

    await setClock(context, 1_798_000_000n + BigInt(COMMIT_SECS) + BigInt(REVEAL_SECS) + 1n);

    const [marketGlobal] = taskMarketPdas.global();
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [guardPda] = taskMarketPdas.guard();

    const remainingAccounts: anchor.web3.AccountMeta[] = [];
    for (let i = 0; i < 3; i++) {
      const [bidPda] = taskMarketPdas.bid(taskId, operators[i]!.publicKey);
      remainingAccounts.push({ pubkey: bidPda, isSigner: false, isWritable: false });
      remainingAccounts.push({ pubkey: agentPdas[i]!, isSigner: false, isWritable: false });
    }

    await taskMarketProgram.methods
      .closeBidding()
      .accountsPartial({
        global: marketGlobal,
        task: taskPda,
        bidBook: bidBookPda,
        guard: guardPda,
        cranker: authority.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();

    const book = await taskMarketProgram.account.bidBook.fetch(bidBookPda);
    expect(book.phase).to.deep.include({ settled: {} });
    expect(book.winnerAgent?.toBase58()).to.equal(agentPdas[1]!.toBase58());
  });

  it('non-winner claims SPL Token bond refund', async () => {
    const op = operators[0]!;
    const [bidPda] = taskMarketPdas.bid(taskId, op.publicKey);
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);
    const [marketGlobal] = taskMarketPdas.global();
    const bidderAta = getAssociatedTokenAddressSync(
      paymentMint, op.publicKey, true, PAYMENT_TOKEN_PROGRAM,
    );
    const feeCollectorAta = getAssociatedTokenAddressSync(
      paymentMint, feeCollector.publicKey, true, PAYMENT_TOKEN_PROGRAM,
    );

    const balanceBefore = await getTokenBalance(context, bidderAta);

    await taskMarketProgram.methods
      .claimBond()
      .accountsPartial({
        global: marketGlobal,
        task: taskPda,
        bidBook: bidBookPda,
        bid: bidPda,
        paymentMint,
        bondEscrow: bondEscrowPda,
        bidderTokenAccount: bidderAta,
        feeCollectorTokenAccount: feeCollectorAta,
        hookAllowlist: null,
        bidder: op.publicKey,
        tokenProgram: PAYMENT_TOKEN_PROGRAM,
      })
      .signers([op])
      .rpc();

    const balanceAfter = await getTokenBalance(context, bidderAta);
    expect(Number(balanceAfter - balanceBefore)).to.equal(expectedBond);
  });
});
