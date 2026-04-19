import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock as setClock } from './helpers/bankrun';
import { padBytes, computeCommitHash } from './helpers/encoding';
import {
  createATA, createToken2022Mint, getTokenBalance, mintTokens, sendTx,
} from './helpers/token';
import { PROGRAM_IDS, capRegPdas, agentRegPdas, taskMarketPdas } from './helpers/accounts';
import {
  Keypair, PublicKey, SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { CapabilityRegistry } from '../target/types/capability_registry';
import type { AgentRegistry } from '../target/types/agent_registry';
import type { TaskMarket } from '../target/types/task_market';

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

// Test suite
describe('task_market commit-reveal bidding (bankrun)', function () {
  this.timeout(120_000);

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

  // 3 agent operators for 3 bidders
  const operators = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

  let paymentMint: PublicKey;
  let stakeMint: PublicKey;
  const taskNonce = new Uint8Array(8).fill(42);

  const agentIds = operators.map((_, i) => {
    const buf = Buffer.alloc(32, 0);
    buf.write(`bid-agent-${i}`, 'utf8');
    return buf;
  });

  let agentDids: Uint8Array[] = [];
  let agentPdas: PublicKey[] = [];
  let taskPda: PublicKey;
  let taskId: Uint8Array;

  // Bid parameters
  const bidAmounts = [500_000n, 300_000n, 700_000n]; // agent1 wins (lowest)
  const nonces = [
    new Uint8Array(32).fill(11),
    new Uint8Array(32).fill(22),
    new Uint8Array(32).fill(33),
  ];

  // Bond = payment_amount * bond_bps / 10_000 = 10_000_000 * 100 / 10_000 = 100_000
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

    const [capConfigPda] = capRegPdas.config();
    const [agentRegGuardPda] = agentRegPdas.guard();

    for (let i = 0; i < 3; i++) {
      const op = operators[i]!;
      const agentId = agentIds[i]!;
      const operatorStakeAta = await createATA(context, authority, stakeMint, op.publicKey);
      await mintTokens(context, authority, stakeMint, operatorStakeAta, mintAuthority, MIN_STAKE);

      const [agentPda] = agentRegPdas.agent(op.publicKey, agentId);
      const [stakePda] = agentRegPdas.stake(agentPda);

      await agentRegProgram.methods
        .registerAgent(
          Array.from(agentId) as unknown as number[],
          padBytes(`ipfs://agent-${i}`, 128) as unknown as number[],
          new BN(1), // capability_mask bit 0
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
          tokenProgram: TOKEN_2022_PROGRAM_ID,
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

    const clientPaymentAta = await createATA(context, authority, paymentMint, client.publicKey);
    await mintTokens(
      context, authority, paymentMint, clientPaymentAta, mintAuthority, PAYMENT_AMOUNT * 10,
    );

    for (const op of operators) {
      const ata = await createATA(context, authority, paymentMint, op.publicKey);
      await mintTokens(context, authority, paymentMint, ata, mintAuthority, expectedBond * 10);
    }

    await createATA(context, authority, paymentMint, feeCollector.publicKey);

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

    // Fund task
    const clientAta = getAssociatedTokenAddressSync(
      paymentMint, client.publicKey, true, TOKEN_2022_PROGRAM_ID,
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    const taskAccount = await taskMarketProgram.account.taskContract.fetch(taskPda);
    taskId = new Uint8Array(taskAccount.taskId as unknown as Uint8Array);
  });

  it('opens bidding on a funded task', async () => {
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();

    const book = await taskMarketProgram.account.bidBook.fetch(bidBookPda);
    expect(book.bondAmount.toNumber()).to.equal(expectedBond);
    expect(book.phase).to.deep.include({ commit: {} });
    expect(book.commitCount).to.equal(0);
    expect(book.revealCount).to.equal(0);

    const task = await taskMarketProgram.account.taskContract.fetch(taskPda);
    expect(task.bidBook?.toBase58()).to.equal(bidBookPda.toBase58());
  });

  it('3 agents commit bids with bond transfers', async () => {
    const [marketGlobal] = taskMarketPdas.global();
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);
    const [regGlobal] = agentRegPdas.global();
    const [capConfigPda] = capRegPdas.config();
    const [tagPda] = capRegPdas.tag(0);

    for (let i = 0; i < 3; i++) {
      const op = operators[i]!;
      const agentDid = agentDids[i]!;
      const commitHash = computeCommitHash(bidAmounts[i]!, nonces[i]!, agentDid);

      const bidderAta = getAssociatedTokenAddressSync(
        paymentMint, op.publicKey, true, TOKEN_2022_PROGRAM_ID,
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
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([op])
        .rpc();
    }

    const book = await taskMarketProgram.account.bidBook.fetch(bidBookPda);
    expect(book.commitCount).to.equal(3);

    const escrowBalance = await getTokenBalance(context, bondEscrowPda);
    expect(Number(escrowBalance)).to.equal(expectedBond * 3);
  });

  it('warp to reveal window, 3 agents reveal bids', async () => {
    // Warp past commit_end
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

      const bid = await taskMarketProgram.account.bid.fetch(bidPda);
      expect(bid.revealed).to.equal(true);
      expect(bid.revealedAmount.toNumber()).to.equal(Number(bidAmounts[i]!));
      expect(bid.slashed).to.equal(false);
    }

    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const book = await taskMarketProgram.account.bidBook.fetch(bidBookPda);
    expect(book.revealCount).to.equal(3);
  });

  it('close_bidding picks lowest bid as winner', async () => {
    await setClock(context, 1_798_000_000n + BigInt(COMMIT_SECS) + BigInt(REVEAL_SECS) + 1n);

    const [marketGlobal] = taskMarketPdas.global();
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [guardPda] = taskMarketPdas.guard();

    // remaining_accounts: [Bid, AgentAccount] pairs for all revealed bids
    const remainingAccounts: anchor.web3.AccountMeta[] = [];
    for (let i = 0; i < 3; i++) {
      const [bidPda] = taskMarketPdas.bid(taskId, operators[i]!.publicKey);
      remainingAccounts.push({
        pubkey: bidPda,
        isSigner: false,
        isWritable: false,
      });
      remainingAccounts.push({
        pubkey: agentPdas[i]!,
        isSigner: false,
        isWritable: false,
      });
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
    // agent 1 bid 300_000 is lowest
    expect(book.winnerAgent?.toBase58()).to.equal(agentPdas[1]!.toBase58());
    expect(book.winnerAmount.toNumber()).to.equal(300_000);

    const task = await taskMarketProgram.account.taskContract.fetch(taskPda);
    expect(task.assignedAgent?.toBase58()).to.equal(agentPdas[1]!.toBase58());
  });

  it('non-winner claims bond refund', async () => {
    const op = operators[0]!; // bid 500_000, not winner
    const [bidPda] = taskMarketPdas.bid(taskId, op.publicKey);
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);
    const [marketGlobal] = taskMarketPdas.global();
    const bidderAta = getAssociatedTokenAddressSync(
      paymentMint, op.publicKey, true, TOKEN_2022_PROGRAM_ID,
    );
    const feeCollectorAta = getAssociatedTokenAddressSync(
      paymentMint, feeCollector.publicKey, true, TOKEN_2022_PROGRAM_ID,
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([op])
      .rpc();

    const balanceAfter = await getTokenBalance(context, bidderAta);
    expect(Number(balanceAfter - balanceBefore)).to.equal(expectedBond);

    const bid = await taskMarketProgram.account.bid.fetch(bidPda);
    expect(bid.refunded).to.equal(true);
    expect(bid.slashed).to.equal(false);
  });

  it('winner claim_bond: bond retained (WinnerRetain path)', async () => {
    const op = operators[1]!; // winner
    const [bidPda] = taskMarketPdas.bid(taskId, op.publicKey);
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);
    const [marketGlobal] = taskMarketPdas.global();
    const bidderAta = getAssociatedTokenAddressSync(
      paymentMint, op.publicKey, true, TOKEN_2022_PROGRAM_ID,
    );
    const feeCollectorAta = getAssociatedTokenAddressSync(
      paymentMint, feeCollector.publicKey, true, TOKEN_2022_PROGRAM_ID,
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([op])
      .rpc();

    const balanceAfter = await getTokenBalance(context, bidderAta);
    expect(Number(balanceAfter - balanceBefore)).to.equal(0); // winner's bond stays in escrow

    const bid = await taskMarketProgram.account.bid.fetch(bidPda);
    expect(bid.refunded).to.equal(true);
  });

  it('second non-winner claims bond refund', async () => {
    const op = operators[2]!; // bid 700_000, not winner
    const [bidPda] = taskMarketPdas.bid(taskId, op.publicKey);
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);
    const [marketGlobal] = taskMarketPdas.global();
    const bidderAta = getAssociatedTokenAddressSync(
      paymentMint, op.publicKey, true, TOKEN_2022_PROGRAM_ID,
    );
    const feeCollectorAta = getAssociatedTokenAddressSync(
      paymentMint, feeCollector.publicKey, true, TOKEN_2022_PROGRAM_ID,
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([op])
      .rpc();

    const balanceAfter = await getTokenBalance(context, bidderAta);
    expect(Number(balanceAfter - balanceBefore)).to.equal(expectedBond);

    const bid = await taskMarketProgram.account.bid.fetch(bidPda);
    expect(bid.refunded).to.equal(true);
  });

  it('double-claim is rejected with AlreadyRefunded', async () => {
    const op = operators[0]!;
    const [bidPda] = taskMarketPdas.bid(taskId, op.publicKey);
    const [bidBookPda] = taskMarketPdas.bidBook(taskId);
    const [bondEscrowPda] = taskMarketPdas.bondEscrow(taskId);
    const [marketGlobal] = taskMarketPdas.global();
    const bidderAta = getAssociatedTokenAddressSync(
      paymentMint, op.publicKey, true, TOKEN_2022_PROGRAM_ID,
    );
    const feeCollectorAta = getAssociatedTokenAddressSync(
      paymentMint, feeCollector.publicKey, true, TOKEN_2022_PROGRAM_ID,
    );

    let threw = false;
    try {
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
          bidder: op.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([op])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true, 'expected AlreadyRefunded error');
  });
});
