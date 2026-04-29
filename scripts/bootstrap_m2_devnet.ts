/**
 * Idempotent M2 program bootstrap for SAEP devnet.
 *
 * Run with:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   SAEP_DEVNET_STAKE_MINT=<mint> \
 *   pnpm tsx scripts/bootstrap_m2_devnet.ts
 *
 * Assumes M1 bootstrap has already run (bootstrap_devnet.ts).
 */

import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GovernanceProgram } from '../target/types/governance_program';
import type { DisputeArbitration } from '../target/types/dispute_arbitration';
import type { NxsStaking } from '../target/types/nxs_staking';
import type { TemplateRegistry } from '../target/types/template_registry';
import type { FeeCollector } from '../target/types/fee_collector';

const PROGRAM_IDS = {
  governance_program: new PublicKey('9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1'),
  dispute_arbitration: new PublicKey('GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa'),
  nxs_staking: new PublicKey('GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z'),
  template_registry: new PublicKey('3QE649JDQbbudJX5j3VkmRSiRvfcu3mHCymPxZn9KC3e'),
  fee_collector: new PublicKey('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu'),
  task_market: new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w'),
  agent_registry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
  capability_registry: new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F'),
  treasury_standard: new PublicKey('6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ'),
  proof_verifier: new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe'),
};

const SAEP_MINT = new PublicKey('HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump');

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

function padLabel(s: string, len: number): number[] {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet.publicKey;
  const conn = provider.connection;

  console.log(`authority: ${authority.toBase58()}`);
  const balance = await conn.getBalance(authority);
  console.log(`balance:   ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 3e9) {
    console.warn('WARN: balance < 3 SOL; M2 inits may fail for rent');
  }

  const stakeMintStr = process.env.SAEP_DEVNET_STAKE_MINT;
  if (!stakeMintStr) {
    console.error('SAEP_DEVNET_STAKE_MINT required');
    process.exit(1);
  }
  const stakeMint = new PublicKey(stakeMintStr);
  console.log(`stake_mint: ${stakeMint.toBase58()}`);

  // 1. governance_program -------------------------------------------------
  {
    const program = new anchor.Program<GovernanceProgram>(
      loadIdl('governance_program'),
      provider,
    );
    const configPda = pda(PROGRAM_IDS.governance_program, [Buffer.from('governance_config')]);
    if (await accountExists(conn, configPda)) {
      console.log('governance_program: already initialized');
    } else {
      console.log('governance_program: initializing...');
      await program.methods
        .initConfig({
          authority,
          nxsStaking: PROGRAM_IDS.nxs_staking,
          capabilityRegistry: PROGRAM_IDS.capability_registry,
          feeCollector: PROGRAM_IDS.fee_collector,
          emergencyCouncil: authority,
          minProposerStake: new BN(0),
          proposerCollateral: new BN(0),
          quorumBps: 400,
          passThresholdBps: 5000,
          metaPassThresholdBps: 6667,
          devModeTimelockOverrideSecs: new BN(300),
        })
        .accountsPartial({ deployer: authority })
        .rpc({ commitment: 'confirmed' });
      console.log('governance_program: initialized');
    }

    // register M2 programs in governance registry
    const registryPda = pda(PROGRAM_IDS.governance_program, [Buffer.from('program_registry')]);
    const registry = await program.account.programRegistry.fetch(registryPda);
    const registered = new Set(registry.entries.map((e: any) => e.programId.toBase58()));

    const toRegister = [
      { label: 'fee_collector', id: PROGRAM_IDS.fee_collector, critical: true },
      { label: 'nxs_staking', id: PROGRAM_IDS.nxs_staking, critical: false },
      { label: 'dispute_arb', id: PROGRAM_IDS.dispute_arbitration, critical: true },
      { label: 'template_reg', id: PROGRAM_IDS.template_registry, critical: false },
      { label: 'task_market', id: PROGRAM_IDS.task_market, critical: true },
    ];

    for (const entry of toRegister) {
      if (registered.has(entry.id.toBase58())) {
        console.log(`  register_program(${entry.label}): already registered`);
        continue;
      }
      console.log(`  register_program(${entry.label})...`);
      await program.methods
        .registerProgram(
          padLabel(entry.label, 16) as unknown as number[],
          entry.id,
          entry.critical,
          Array.from(Buffer.alloc(32)) as unknown as number[],
          512,
        )
        .accountsPartial({ authority })
        .rpc({ commitment: 'confirmed' });
    }
    console.log('governance_program: programs registered');
  }

  // 2. nxs_staking --------------------------------------------------------
  {
    const program = new anchor.Program<NxsStaking>(loadIdl('nxs_staking'), provider);
    const configPda = pda(PROGRAM_IDS.nxs_staking, [Buffer.from('staking_config')]);
    if (await accountExists(conn, configPda)) {
      console.log('nxs_staking: already initialized');
    } else {
      console.log('nxs_staking: initializing...');
      await program.methods
        .initialize(authority)
        .accountsPartial({ payer: authority })
        .rpc({ commitment: 'confirmed' });
      console.log('nxs_staking: initialized');
    }

    const poolPda = pda(PROGRAM_IDS.nxs_staking, [Buffer.from('staking_pool')]);
    if (await accountExists(conn, poolPda)) {
      console.log('nxs_staking: pool already exists');
    } else {
      console.log('nxs_staking: creating pool...');
      await program.methods
        .initPool(
          stakeMint,
          new BN(86400),       // 1-day epoch for devnet
          new BN(1_000_000),   // 1 SAEP reward/epoch
        )
        .accountsPartial({ authority })
        .rpc({ commitment: 'confirmed' });
      console.log('nxs_staking: pool created');
    }
  }

  // 3. dispute_arbitration ------------------------------------------------
  {
    const program = new anchor.Program<DisputeArbitration>(
      loadIdl('dispute_arbitration'),
      provider,
    );
    const configPda = pda(PROGRAM_IDS.dispute_arbitration, [Buffer.from('dispute_config')]);
    if (await accountExists(conn, configPda)) {
      console.log('dispute_arbitration: already initialized');
    } else {
      console.log('dispute_arbitration: initializing...');
      await program.methods
        .initialize({
          authority,
          taskMarket: PROGRAM_IDS.task_market,
          nxsStaking: PROGRAM_IDS.nxs_staking,
          feeCollector: PROGRAM_IDS.fee_collector,
          agentRegistry: PROGRAM_IDS.agent_registry,
          switchboardProgram: PublicKey.default,
          emergencyCouncil: authority,
          minStake: new BN(1_000_000),
          minLockSecs: new BN(86400),
        })
        .accountsPartial({ payer: authority })
        .rpc({ commitment: 'confirmed' });
      console.log('dispute_arbitration: initialized');
    }

    const guardPda = pda(PROGRAM_IDS.dispute_arbitration, [Buffer.from('guard')]);
    if (await accountExists(conn, guardPda)) {
      console.log('dispute_arbitration: guard already exists');
    } else {
      console.log('dispute_arbitration: creating guard...');
      await program.methods
        .initGuard([PROGRAM_IDS.task_market])
        .accountsPartial({
          config: configPda,
          authority,
        })
        .rpc({ commitment: 'confirmed' });
      console.log('dispute_arbitration: guard created');
    }
  }

  // 4. template_registry --------------------------------------------------
  {
    const program = new anchor.Program<TemplateRegistry>(
      loadIdl('template_registry'),
      provider,
    );
    const globalPda = pda(PROGRAM_IDS.template_registry, [Buffer.from('tpl_global')]);
    if (await accountExists(conn, globalPda)) {
      console.log('template_registry: already initialized');
    } else {
      console.log('template_registry: initializing...');
      await program.methods
        .initGlobal(
          PROGRAM_IDS.agent_registry,
          PROGRAM_IDS.treasury_standard,
          authority,     // fee_collector ATA — devnet placeholder
          2000,          // royalty_cap 20%
          500,           // platform_fee 5%
          stakeMint,     // rent_escrow_mint
        )
        .accountsPartial({
          global: globalPda,
          authority,
        })
        .rpc({ commitment: 'confirmed' });
      console.log('template_registry: initialized');
    }
  }

  // 5. fee_collector ------------------------------------------------------
  {
    const program = new anchor.Program<FeeCollector>(loadIdl('fee_collector'), provider);
    const configPda = pda(PROGRAM_IDS.fee_collector, [Buffer.from('fee_config')]);
    if (await accountExists(conn, configPda)) {
      console.log('fee_collector: already initialized');
    } else {
      console.log('fee_collector: initializing...');
      await program.methods
        .initConfig({
          authority,
          metaAuthority: authority,
          governanceProgram: PROGRAM_IDS.governance_program,
          nxsStaking: PROGRAM_IDS.nxs_staking,
          agentRegistry: PROGRAM_IDS.agent_registry,
          disputeArbitration: PROGRAM_IDS.dispute_arbitration,
          emergencyCouncil: authority,
          saepMint: SAEP_MINT,
          externalSaepMint: PublicKey.default,
          grantRecipient: authority,
          treasuryRecipient: authority,
          burnBps: 5000,
          stakerShareBps: 2000,
          grantShareBps: 2000,
          treasuryShareBps: 1000,
          epochDurationSecs: new BN(86400),
          claimWindowSecs: new BN(7 * 86400),
          minEpochTotalForBurn: new BN(0),
        })
        .accountsPartial({ payer: authority })
        .rpc({ commitment: 'confirmed' });
      console.log('fee_collector: initialized');
    }

    const guardPda = pda(PROGRAM_IDS.fee_collector, [Buffer.from('guard')]);
    if (await accountExists(conn, guardPda)) {
      console.log('fee_collector: guard already exists');
    } else {
      console.log('fee_collector: creating guard...');
      await program.methods
        .initGuard([PROGRAM_IDS.task_market])
        .accountsPartial({
          allowlist: pda(PROGRAM_IDS.fee_collector, [Buffer.from('hook_allowlist')]),
          authority,
        })
        .rpc({ commitment: 'confirmed' });
      console.log('fee_collector: guard created');
    }
  }

  console.log('\nM2 bootstrap complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
