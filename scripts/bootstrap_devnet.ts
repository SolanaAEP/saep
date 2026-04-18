/**
 * Idempotent init_global bootstrap for SAEP devnet.
 *
 * Run with:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   pnpm tsx scripts/bootstrap_devnet.ts
 *
 * Checks each program's global account; calls init_global only when missing.
 * Skips proof_verifier (already init'd on devnet per task-market-audit report).
 */

import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AgentRegistry } from '../target/types/agent_registry';
import type { CapabilityRegistry } from '../target/types/capability_registry';
import type { TaskMarket } from '../target/types/task_market';
import type { TreasuryStandard } from '../target/types/treasury_standard';

const PROGRAM_IDS = {
  task_market: new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w'),
  agent_registry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
  treasury_standard: new PublicKey('6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ'),
  proof_verifier: new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe'),
  fee_collector: new PublicKey('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu'),
  capability_registry: new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F'),
  dispute_arbitration: new PublicKey('GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa'),
};

// Devnet USDC. Additional allowed mints can be set later via governance.
const USDC_DEVNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Parameters — tunable via governance after init.
const PROTOCOL_FEE_BPS = 100; // 1%
const SOLREP_FEE_BPS = 50;    // 0.5%
const DISPUTE_WINDOW_SECS = 86400; // 24h
const MAX_DEADLINE_SECS = 30 * 86400; // 30d
const MIN_AGENT_STAKE = 0; // devnet: 0 stake to ease onboarding
const SLASH_BPS = 1000;
const REPUTATION_DECAY_SECS = 86400;
const DEFAULT_TREASURY_DAILY_LIMIT = 1_000_000_000_000n; // 1e12 base units
const MAX_TREASURY_DAILY_LIMIT = 1_000_000_000_000_000n; // 1e15

function loadIdl(name: string): anchor.Idl {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `target/idl/${name}.json`), 'utf8'),
  );
}

function pda(programId: PublicKey, seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function accountExists(conn: anchor.web3.Connection, key: PublicKey): Promise<boolean> {
  const info = await conn.getAccountInfo(key);
  return info !== null;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet.publicKey;
  const conn = provider.connection;

  console.log(`authority: ${authority.toBase58()}`);
  const balance = await conn.getBalance(authority);
  console.log(`balance:   ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 2e9) {
    console.warn('WARN: balance < 2 SOL; init_global may fail for rent');
  }

  // capability_registry ------------------------------------------------------
  {
    const program = new anchor.Program<CapabilityRegistry>(
      loadIdl('capability_registry'),
      provider,
    );
    const configPda = pda(PROGRAM_IDS.capability_registry, [Buffer.from('config')]);
    if (await accountExists(conn, configPda)) {
      console.log('capability_registry: already initialized');
    } else {
      console.log('capability_registry: initializing...');
      await program.methods
        .initialize(authority)
        .accountsPartial({ payer: authority })
        .rpc({ commitment: 'confirmed' });
      console.log('capability_registry: initialized');
    }
  }

  // agent_registry -----------------------------------------------------------
  {
    const program = new anchor.Program<AgentRegistry>(loadIdl('agent_registry'), provider);
    const globalPda = pda(PROGRAM_IDS.agent_registry, [Buffer.from('global')]);
    if (await accountExists(conn, globalPda)) {
      console.log('agent_registry: already initialized');
    } else {
      console.log('agent_registry: initializing...');
      // stake_mint = USDC on devnet; slashing disabled on devnet (MIN_STAKE=0)
      await program.methods
        .initGlobal(
          authority,
          PROGRAM_IDS.capability_registry,
          PROGRAM_IDS.task_market,
          PROGRAM_IDS.dispute_arbitration,
          PublicKey.default, // treasury_standard pointer — not strictly required for init
          USDC_DEVNET,
          PROGRAM_IDS.proof_verifier,
          new anchor.BN(MIN_AGENT_STAKE),
          SLASH_BPS,
          new anchor.BN(REPUTATION_DECAY_SECS),
        )
        .accountsPartial({ payer: authority, stakeMintInfo: USDC_DEVNET })
        .rpc({ commitment: 'confirmed' });
      console.log('agent_registry: initialized');
    }
  }

  // treasury_standard --------------------------------------------------------
  {
    const program = new anchor.Program<TreasuryStandard>(
      loadIdl('treasury_standard'),
      provider,
    );
    const globalPda = pda(PROGRAM_IDS.treasury_standard, [Buffer.from('global')]);
    if (await accountExists(conn, globalPda)) {
      console.log('treasury_standard: already initialized');
    } else {
      console.log('treasury_standard: initializing...');
      await program.methods
        .initGlobal(
          authority,
          PROGRAM_IDS.agent_registry,
          PublicKey.default, // jupiter_program — placeholder; set via governance
          new anchor.BN(DEFAULT_TREASURY_DAILY_LIMIT.toString()),
          new anchor.BN(MAX_TREASURY_DAILY_LIMIT.toString()),
        )
        .accountsPartial({ payer: authority })
        .rpc({ commitment: 'confirmed' });
      console.log('treasury_standard: initialized');
    }
  }

  // task_market --------------------------------------------------------------
  {
    const program = new anchor.Program<TaskMarket>(loadIdl('task_market'), provider);
    const globalPda = pda(PROGRAM_IDS.task_market, [Buffer.from('market_global')]);
    if (await accountExists(conn, globalPda)) {
      console.log('task_market: already initialized');
    } else {
      console.log('task_market: initializing...');
      const allowedMints: PublicKey[] = Array(8).fill(PublicKey.default);
      allowedMints[0] = USDC_DEVNET;
      await program.methods
        .initGlobal(
          authority,
          PROGRAM_IDS.agent_registry,
          PROGRAM_IDS.treasury_standard,
          PROGRAM_IDS.proof_verifier,
          PROGRAM_IDS.fee_collector,
          authority, // solrep_pool placeholder — set via governance
          PROTOCOL_FEE_BPS,
          SOLREP_FEE_BPS,
          new anchor.BN(DISPUTE_WINDOW_SECS),
          new anchor.BN(MAX_DEADLINE_SECS),
          allowedMints as unknown as PublicKey[],
        )
        .accountsPartial({ payer: authority })
        .rpc({ commitment: 'confirmed' });
      console.log('task_market: initialized');
    }
  }

  console.log('\nbootstrap complete. next: seed capabilities via scripts/seed_capabilities.ts');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
