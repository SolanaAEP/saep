import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock, warpClockTo } from './helpers/bankrun';
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
const EXPIRE_GRACE_SECS = 3_600;
const T0 = 1_700_000_000n;
const DEADLINE_OFFSET_SECS = 600;

function padBytes(s: string, len: number): number[] {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
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
  guard: () => PublicKey.findProgramAddressSync(
    [Buffer.from('guard')], PROGRAM_IDS.task_market,
  ),
};

describe('bankrun: task_market — expire CU coverage', function () {
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
  let taskPda: PublicKey;

  const agentId = Buffer.alloc(32, 0);
  agentId.write('expire-test-agent', 'utf8');

  const taskNonce = new Uint8Array(8);
  Buffer.from('exp-001', 'utf8').copy(taskNonce);

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
        padBytes('ipfs://agent-expire-test', 128) as unknown as number[],
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

    const [taskPdaLocal] = taskMarketPdas.task(client.publicKey, taskNonce);
    taskPda = taskPdaLocal;

    const taskPayload = {
      kind: { generic: { capabilityBit: 0, argsHash: Array(32).fill(0) } },
      capabilityBit: 0,
      criteria: Buffer.alloc(0),
      requiresPersonhood: { none: {} },
    };

    const deadline = Number(T0) + DEADLINE_OFFSET_SECS;
    await taskMarketProgram.methods
      .createTask(
        Array.from(taskNonce) as unknown as number[],
        Array.from(agentDid) as unknown as number[],
        paymentMint,
        new BN(PAYMENT_AMOUNT),
        taskPayload,
        Array(32).fill(0) as unknown as number[],
        new BN(deadline),
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

    const [escrowPda] = taskMarketPdas.escrow(taskPda);
    const [tmGuardPda] = taskMarketPdas.guard();

    await taskMarketProgram.methods
      .fundTask()
      .accountsPartial({
        global: marketGlobalPda,
        task: taskPda,
        paymentMint,
        escrow: escrowPda,
        clientTokenAccount: clientAta,
        hookAllowlist: null,
        guard: tmGuardPda,
        client: client.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([client])
      .rpc();
  });

  it('program id matches Anchor.toml', () => {
    expect(taskMarketProgram.programId.toBase58()).to.equal(
      PROGRAM_IDS.task_market.toBase58(),
    );
  });

  it('expire rejects pre-grace-period (NotExpired)', async () => {
    const [marketGlobalPda] = taskMarketPdas.global();
    const [escrowPda] = taskMarketPdas.escrow(taskPda);
    const [tmGuardPda] = taskMarketPdas.guard();
    const [regGlobalPda] = agentRegPdas.global();

    const deadline = Number(T0) + DEADLINE_OFFSET_SECS;
    await setBankrunClock(context, BigInt(deadline + EXPIRE_GRACE_SECS - 60));

    let rejected = false;
    try {
      await taskMarketProgram.methods
        .expire()
        .accountsPartial({
          global: marketGlobalPda,
          task: taskPda,
          paymentMint,
          escrow: escrowPda,
          clientTokenAccount: clientAta,
          client: client.publicKey,
          agentRegistryProgram: PROGRAM_IDS.agent_registry,
          registryGlobal: regGlobalPda,
          agentAccount: agentPda,
          selfProgram: PROGRAM_IDS.task_market,
          hookAllowlist: null,
          guard: tmGuardPda,
          cranker: authority.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    } catch (e) {
      rejected = true;
      expect(String(e)).to.match(/NotExpired/);
    }
    expect(rejected).to.equal(true);
  });

  it('expire transitions Funded → Expired and refunds escrow to client', async () => {
    const [marketGlobalPda] = taskMarketPdas.global();
    const [escrowPda] = taskMarketPdas.escrow(taskPda);
    const [tmGuardPda] = taskMarketPdas.guard();
    const [regGlobalPda] = agentRegPdas.global();

    const deadline = Number(T0) + DEADLINE_OFFSET_SECS;
    await warpClockTo(context, BigInt(deadline + EXPIRE_GRACE_SECS + 1));

    const escrowBefore = await getTokenBalance(context, escrowPda);
    const clientBefore = await getTokenBalance(context, clientAta);
    expect(Number(escrowBefore)).to.equal(PAYMENT_AMOUNT);

    await taskMarketProgram.methods
      .expire()
      .accountsPartial({
        global: marketGlobalPda,
        task: taskPda,
        paymentMint,
        escrow: escrowPda,
        clientTokenAccount: clientAta,
        client: client.publicKey,
        agentRegistryProgram: PROGRAM_IDS.agent_registry,
        registryGlobal: regGlobalPda,
        agentAccount: agentPda,
        selfProgram: PROGRAM_IDS.task_market,
        hookAllowlist: null,
        guard: tmGuardPda,
        cranker: authority.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const escrowAfter = await getTokenBalance(context, escrowPda);
    const clientAfter = await getTokenBalance(context, clientAta);
    expect(Number(escrowAfter)).to.equal(0);
    expect(Number(clientAfter - clientBefore)).to.equal(PAYMENT_AMOUNT);

    const t = await taskMarketProgram.account.taskContract.fetch(taskPda);
    expect(t.status).to.deep.include({ expired: {} });
  });
});
