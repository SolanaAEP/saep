import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { startAnchor, BankrunProvider } from 'anchor-bankrun';
import { ProgramTestContext } from 'solana-bankrun';
import { setBankrunClock } from './helpers/bankrun';
import { padBytes } from './helpers/encoding';
import {
  createATA, createToken2022Mint, getTokenBalance, mintTokens, sendTx,
} from './helpers/token';
import { PROGRAM_IDS, capRegPdas, agentRegPdas, treasuryPdas } from './helpers/accounts';
import {
  Keypair, PublicKey, SystemProgram,
  LAMPORTS_PER_SOL, SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';

import type { CapabilityRegistry } from '../target/types/capability_registry';
import type { AgentRegistry } from '../target/types/agent_registry';
import type { TreasuryStandard } from '../target/types/treasury_standard';

const MIN_STAKE = 1_000_000;
const SLASH_TIMELOCK_SECS = 10;
const INITIAL_BALANCE = 10_000_000;
const T0 = 1_700_000_000n;

const PER_TX_LIMIT = 1_000_000;
const DAILY_LIMIT = 2_000_000;
const WEEKLY_LIMIT = 5_000_000;
const MAX_DAILY_LIMIT = 10_000_000;
const DEFAULT_DAILY_LIMIT = 500_000;

describe('bankrun: treasury_standard — init + fund + withdraw + stream CU coverage', function () {
  this.timeout(60_000);

  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let capRegProgram: anchor.Program<CapabilityRegistry>;
  let agentRegProgram: anchor.Program<AgentRegistry>;
  let treasuryProgram: anchor.Program<TreasuryStandard>;

  let authority: Keypair;
  const operator = Keypair.generate();
  const mintAuthority = Keypair.generate();

  let mint: PublicKey;
  let operatorAta: PublicKey;
  let agentPda: PublicKey;
  let agentDid: Uint8Array;

  const agentId = Buffer.alloc(32, 0);
  agentId.write('treasury-test-agent', 'utf8');

  before(async () => {
    context = await startAnchor('.', [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    authority = context.payer;

    const capRegIdl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/capability_registry.json'), 'utf8'));
    const agentRegIdl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/agent_registry.json'), 'utf8'));
    const treasuryIdl = JSON.parse(readFileSync(
      resolve(process.cwd(), 'target/idl/treasury_standard.json'), 'utf8'));

    capRegProgram = new anchor.Program<CapabilityRegistry>(capRegIdl, provider);
    agentRegProgram = new anchor.Program<AgentRegistry>(agentRegIdl, provider);
    treasuryProgram = new anchor.Program<TreasuryStandard>(treasuryIdl, provider);

    for (const kp of [operator, mintAuthority]) {
      context.setAccount(kp.publicKey, {
        lamports: 100 * LAMPORTS_PER_SOL,
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        executable: false,
      });
    }

    await setBankrunClock(context, T0);

    mint = await createToken2022Mint(context, authority, mintAuthority.publicKey, 6);

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
        mint,
        PROGRAM_IDS.proof_verifier,
        new BN(MIN_STAKE),
        1000,
        new BN(SLASH_TIMELOCK_SECS),
      )
      .accountsPartial({ payer: authority.publicKey, stakeMintInfo: mint })
      .rpc();

    const [regGlobalPda] = agentRegPdas.global();
    await agentRegProgram.methods
      .initGuard([PROGRAM_IDS.agent_registry])
      .accountsPartial({
        global: regGlobalPda,
        authority: authority.publicKey,
      })
      .rpc();

    operatorAta = await createATA(context, authority, mint, operator.publicKey);
    await mintTokens(context, authority, mint, operatorAta, mintAuthority, INITIAL_BALANCE);

    const [capConfigPda] = capRegPdas.config();
    const [agentPdaLocal] = agentRegPdas.agent(operator.publicKey, agentId);
    const [stakePda] = agentRegPdas.stake(agentPdaLocal);
    const [arGuardPda] = agentRegPdas.guard();

    await agentRegProgram.methods
      .registerAgent(
        Array.from(agentId) as unknown as number[],
        padBytes('ipfs://agent-treasury-test', 128) as unknown as number[],
        new BN(1),
        new BN(1_000_000),
        new BN(100),
        new BN(MIN_STAKE),
      )
      .accountsPartial({
        global: regGlobalPda,
        capabilityConfig: capConfigPda,
        stakeMint: mint,
        stakeVault: stakePda,
        operatorTokenAccount: operatorAta,
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

    await treasuryProgram.methods
      .initGlobal(
        authority.publicKey,
        PROGRAM_IDS.agent_registry,
        PublicKey.default,
        new BN(DEFAULT_DAILY_LIMIT),
        new BN(MAX_DAILY_LIMIT),
      )
      .accountsPartial({ payer: authority.publicKey })
      .rpc();

    await treasuryProgram.methods
      .initGuard([PROGRAM_IDS.treasury_standard])
      .accountsPartial({ authority: authority.publicKey })
      .rpc();

    await treasuryProgram.methods
      .setGlobalCallTargets([TOKEN_2022_PROGRAM_ID], [])
      .accountsPartial({ authority: authority.publicKey })
      .rpc();

    await treasuryProgram.methods
      .addAllowedMint(mint)
      .accountsPartial({ authority: authority.publicKey })
      .rpc();
  });

  it('program id matches Anchor.toml', () => {
    expect(treasuryProgram.programId.toBase58()).to.equal(
      PROGRAM_IDS.treasury_standard.toBase58(),
    );
  });

  it('init_treasury creates AgentTreasury bound to registered agent', async () => {
    const [treasuryPda] = treasuryPdas.treasury(agentDid);
    await treasuryProgram.methods
      .initTreasury(
        Array.from(agentDid) as unknown as number[],
        new BN(DAILY_LIMIT),
        new BN(PER_TX_LIMIT),
        new BN(WEEKLY_LIMIT),
      )
      .accountsPartial({
        global: treasuryPdas.global()[0],
        treasury: treasuryPda,
        operator: operator.publicKey,
        agentRegistryProgram: PROGRAM_IDS.agent_registry,
        registryGlobal: agentRegPdas.global()[0],
        agentAccount: agentPda,
      })
      .signers([operator])
      .rpc();

    const t = await treasuryProgram.account.agentTreasury.fetch(treasuryPda);
    expect(Buffer.from(t.agentDid).equals(Buffer.from(agentDid))).to.equal(true);
    expect(t.operator.toBase58()).to.equal(operator.publicKey.toBase58());
    expect(t.perTxLimit.toNumber()).to.equal(PER_TX_LIMIT);
    expect(t.dailySpendLimit.toNumber()).to.equal(DAILY_LIMIT);
    expect(t.weeklyLimit.toNumber()).to.equal(WEEKLY_LIMIT);
    expect(t.streamingActive).to.equal(false);
  });

  it('fund_treasury transfers tokens into mint-scoped vault', async () => {
    const amount = 2_000_000;
    const [treasuryPda] = treasuryPdas.treasury(agentDid);
    const [vaultPda] = treasuryPdas.vault(agentDid, mint);
    const opBefore = await getTokenBalance(context, operatorAta);

    await treasuryProgram.methods
      .fundTreasury(new BN(amount))
      .accountsPartial({
        global: treasuryPdas.global()[0],
        allowedMints: treasuryPdas.allowedMints()[0],
        treasury: treasuryPda,
        allowedTargets: null,
        mint,
        vault: vaultPda,
        funderTokenAccount: operatorAta,
        hookAllowlist: null,
        guard: treasuryPdas.guard()[0],
        funder: operator.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    const vaultAfter = await getTokenBalance(context, vaultPda);
    const opAfter = await getTokenBalance(context, operatorAta);
    expect(Number(vaultAfter)).to.equal(amount);
    expect(Number(opBefore - opAfter)).to.equal(amount);
  });

  it('withdraw draws from vault under per-tx limit, no price feed', async () => {
    const amount = 500_000;
    const [treasuryPda] = treasuryPdas.treasury(agentDid);
    const [vaultPda] = treasuryPdas.vault(agentDid, mint);
    const vaultBefore = await getTokenBalance(context, vaultPda);
    const opBefore = await getTokenBalance(context, operatorAta);

    await treasuryProgram.methods
      .withdraw(new BN(amount))
      .accountsPartial({
        global: treasuryPdas.global()[0],
        treasury: treasuryPda,
        allowedTargets: null,
        mint,
        vault: vaultPda,
        destination: operatorAta,
        priceFeed: null,
        hookAllowlist: null,
        guard: treasuryPdas.guard()[0],
        operator: operator.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    const vaultAfter = await getTokenBalance(context, vaultPda);
    const opAfter = await getTokenBalance(context, operatorAta);
    expect(Number(vaultBefore - vaultAfter)).to.equal(amount);
    expect(Number(opAfter - opBefore)).to.equal(amount);

    const t = await treasuryProgram.account.agentTreasury.fetch(treasuryPda);
    expect(t.spentToday.toNumber()).to.equal(amount);
    expect(t.spentThisWeek.toNumber()).to.equal(amount);
  });

  it('init_stream escrows deposit_total = rate × duration + flips streaming_active', async () => {
    const nonce = Buffer.alloc(8, 0);
    nonce.write('strm-001', 'utf8');
    const rate = 100;
    const duration = 60;
    const deposit = rate * duration;

    const [treasuryPda] = treasuryPdas.treasury(agentDid);
    const [streamPda] = treasuryPdas.stream(agentDid, operator.publicKey, nonce);
    const [escrowPda] = treasuryPdas.streamEscrow(streamPda);
    const opBefore = await getTokenBalance(context, operatorAta);

    await treasuryProgram.methods
      .initStream(
        Array.from(nonce) as unknown as number[],
        new BN(rate),
        new BN(duration),
      )
      .accountsPartial({
        global: treasuryPdas.global()[0],
        allowedMints: treasuryPdas.allowedMints()[0],
        treasury: treasuryPda,
        allowedTargets: null,
        stream: streamPda,
        payerMint: mint,
        payoutMint: mint,
        escrow: escrowPda,
        clientTokenAccount: operatorAta,
        hookAllowlist: null,
        guard: treasuryPdas.guard()[0],
        client: operator.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([operator])
      .rpc();

    const escrowAfter = await getTokenBalance(context, escrowPda);
    const opAfter = await getTokenBalance(context, operatorAta);
    expect(Number(escrowAfter)).to.equal(deposit);
    expect(Number(opBefore - opAfter)).to.equal(deposit);

    const t = await treasuryProgram.account.agentTreasury.fetch(treasuryPda);
    expect(t.streamingActive).to.equal(true);
    expect(t.streamRatePerSec.toNumber()).to.equal(rate);
  });
});
