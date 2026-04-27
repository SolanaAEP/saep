#!/usr/bin/env tsx
/**
 * RPC benchmark: compares default Solana RPC vs Synapse RPC endpoint
 * for common SAEP operations.
 *
 * Usage:
 *   SYNAPSE_RPC_URL=http://... tsx scripts/rpc-benchmark.ts
 *   DEFAULT_RPC_URL=https://api.devnet.solana.com SYNAPSE_RPC_URL=... tsx scripts/rpc-benchmark.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { resolveCluster, taskMarketProgram, makeProvider, agentRegistryProgram } from '@saep/sdk';

const DEFAULT_RPC = process.env.DEFAULT_RPC_URL ?? 'https://api.devnet.solana.com';
const SYNAPSE_RPC = process.env.SYNAPSE_RPC_URL;
const ITERATIONS = Number(process.env.ITERATIONS ?? '5');

if (!SYNAPSE_RPC) {
  console.error('SYNAPSE_RPC_URL is required');
  process.exit(1);
}

interface BenchResult {
  operation: string;
  default_ms: number;
  synapse_ms: number;
  speedup: string;
}

const dummyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T>(tx: T) => tx,
  signAllTransactions: async <T>(txs: T[]) => txs,
};

async function bench(name: string, fn: (conn: Connection) => Promise<void>): Promise<BenchResult> {
  const defaultConn = new Connection(DEFAULT_RPC, 'confirmed');
  const synapseConn = new Connection(SYNAPSE_RPC!, 'confirmed');

  const defaultTimes: number[] = [];
  const synapseTimes: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await fn(defaultConn);
    defaultTimes.push(performance.now() - t0);

    const t1 = performance.now();
    await fn(synapseConn);
    synapseTimes.push(performance.now() - t1);
  }

  const defaultAvg = median(defaultTimes);
  const synapseAvg = median(synapseTimes);
  const speedup = defaultAvg / synapseAvg;

  return {
    operation: name,
    default_ms: Math.round(defaultAvg),
    synapse_ms: Math.round(synapseAvg),
    speedup: `${speedup.toFixed(2)}x`,
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function main() {
  console.log(`RPC benchmark: ${ITERATIONS} iterations per operation`);
  console.log(`  default: ${DEFAULT_RPC}`);
  console.log(`  synapse: ${SYNAPSE_RPC}`);
  console.log();

  const config = resolveCluster({ cluster: 'devnet' });
  const results: BenchResult[] = [];

  results.push(
    await bench('getLatestBlockhash', async (conn) => {
      await conn.getLatestBlockhash('confirmed');
    }),
  );

  results.push(
    await bench('getSlot', async (conn) => {
      await conn.getSlot('confirmed');
    }),
  );

  results.push(
    await bench('taskMarket.all (fetch all tasks)', async (conn) => {
      const provider = makeProvider({ connection: conn, wallet: dummyWallet });
      const tm = taskMarketProgram(provider, config);
      await tm.account.taskContract.all();
    }),
  );

  results.push(
    await bench('agentRegistry.all (fetch all agents)', async (conn) => {
      const provider = makeProvider({ connection: conn, wallet: dummyWallet });
      const ar = agentRegistryProgram(provider, config);
      await ar.account.agentAccount.all();
    }),
  );

  results.push(
    await bench('getAccountInfo (system program)', async (conn) => {
      await conn.getAccountInfo(new PublicKey('11111111111111111111111111111111'));
    }),
  );

  // output
  console.log('--- results ---');
  console.log(formatTable(results));
  console.log();

  const avgSpeedup = results.reduce((sum, r) => sum + parseFloat(r.speedup), 0) / results.length;
  console.log(`average speedup: ${avgSpeedup.toFixed(2)}x`);
}

function formatTable(results: BenchResult[]): string {
  const header = `${'operation'.padEnd(40)} ${'default'.padStart(10)} ${'synapse'.padStart(10)} ${'speedup'.padStart(10)}`;
  const separator = '-'.repeat(header.length);
  const rows = results.map(
    (r) =>
      `${r.operation.padEnd(40)} ${`${r.default_ms}ms`.padStart(10)} ${`${r.synapse_ms}ms`.padStart(10)} ${r.speedup.padStart(10)}`,
  );
  return [header, separator, ...rows].join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
