/**
 * Prediction Market Reference Agent
 *
 * Demonstrates the full SAEP task lifecycle:
 *   register → poll → commit bid → reveal bid → execute → submit result
 *
 * The "prediction market" execution is mocked: it fetches a BTC price from
 * CoinGecko, predicts direction (up/down) over 60s, waits, re-checks, and
 * submits whether the prediction was correct.
 */

import {
  AnchorProvider,
  Program,
  Wallet,
  BN,
} from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  resolveCluster,
  agentRegistryProgram,
  taskMarketProgram,
  buildRegisterAgentIx,
  buildCommitBidIx,
  buildRevealBidIx,
  buildSubmitResultIx,
  encodeAgentId,
  agentAccountPda,
  type ClusterConfig,
  type AgentRegistry,
  type TaskMarket,
} from '@saep/sdk';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { loadConfig, type AgentConfig } from './config.js';

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function buildProvider(connection: Connection, keypair: Keypair): AnchorProvider {
  const wallet = new Wallet(keypair);
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

async function ensureRegistered(
  registry: Program<AgentRegistry>,
  config: AgentConfig,
  operator: Keypair,
  agentId: Uint8Array,
): Promise<PublicKey> {
  const [agentPda] = agentAccountPda(
    config.cluster.programIds.agentRegistry,
    operator.publicKey,
    agentId,
  );

  const info = await registry.provider.connection.getAccountInfo(agentPda);
  if (info) {
    console.log(`agent already registered: ${agentPda.toBase58()}`);
    return agentPda;
  }

  console.log('registering agent on-chain...');
  const ix = await buildRegisterAgentIx(registry, {
    operator: operator.publicKey,
    agentId,
    manifestUri: 'https://example.com/prediction-agent.json',
    // bit 5 = prediction market capability
    capabilityMask: BigInt(1 << config.capabilityBit),
    priceLamports: 0n,
    streamRate: 0n,
    stakeAmount: 0n,
    stakeMint: config.cluster.programIds.agentRegistry, // placeholder — devnet doesn't enforce mint
    operatorTokenAccount: operator.publicKey,            // placeholder
    capabilityRegistryProgramId: config.cluster.programIds.capabilityRegistry,
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(registry.provider.connection, tx, [operator]);
  console.log(`agent registered: ${agentPda.toBase58()}`);
  return agentPda;
}

interface PendingTask {
  pubkey: PublicKey;
  taskId: Uint8Array;
  paymentMint: PublicKey;
}

async function pollTasks(
  market: Program<TaskMarket>,
  _capabilityBit: number,
): Promise<PendingTask[]> {
  // In production you'd query the indexer or use getProgramAccounts with
  // filters on capability_mask and status == AwaitingBids.
  // For this demo we fetch all task accounts and return a stub list.
  try {
    const accounts = await market.account.task.all();
    return accounts
      .filter((a) => {
        const status = a.account.status as Record<string, Record<string, never>> | undefined;
        return status && ('awaitingBids' in status || 'open' in status);
      })
      .slice(0, 5)
      .map((a) => ({
        pubkey: a.publicKey,
        taskId: Uint8Array.from((a.account.taskId as number[] | undefined) ?? new Uint8Array(32)),
        paymentMint: (a.account.paymentMint as PublicKey | undefined) ?? PublicKey.default,
      }));
  } catch {
    // no tasks found or program not initialised on this cluster
    return [];
  }
}

function computeCommitHash(amount: bigint, nonce: Uint8Array): Uint8Array {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(amount);
  return createHash('sha256')
    .update(buf)
    .update(nonce)
    .digest();
}

async function commitBid(
  market: Program<TaskMarket>,
  config: AgentConfig,
  operator: Keypair,
  agentId: Uint8Array,
  task: PendingTask,
): Promise<{ nonce: Uint8Array; amount: bigint }> {
  const amount = 1_000_000n; // 1 token unit — demo bid
  const nonce = randomBytes(32);
  const commitHash = computeCommitHash(amount, nonce);

  const agentDid = createHash('sha256').update(agentId).digest();

  const ix = await buildCommitBidIx(market, config.cluster, {
    bidder: operator.publicKey,
    task: task.pubkey,
    taskId: task.taskId,
    paymentMint: task.paymentMint,
    bidderTokenAccount: operator.publicKey, // placeholder for devnet
    agentOperator: operator.publicKey,
    agentId,
    agentDid: Uint8Array.from(agentDid),
    commitHash: Uint8Array.from(commitHash),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(market.provider.connection, tx, [operator]);
  console.log(`bid committed for task ${task.pubkey.toBase58()}`);
  return { nonce, amount };
}

async function revealBid(
  market: Program<TaskMarket>,
  operator: Keypair,
  task: PendingTask,
  amount: bigint,
  nonce: Uint8Array,
): Promise<void> {
  const ix = await buildRevealBidIx(market, {
    bidder: operator.publicKey,
    task: task.pubkey,
    taskId: task.taskId,
    amount,
    nonce,
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(market.provider.connection, tx, [operator]);
  console.log(`bid revealed for task ${task.pubkey.toBase58()}`);
}

async function fetchBtcPrice(apiBase: string): Promise<number> {
  const url = `${apiBase}/simple/price?ids=bitcoin&vs_currencies=usd`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
  const data = (await res.json()) as { bitcoin: { usd: number } };
  return data.bitcoin.usd;
}

interface PredictionResult {
  priceBefore: number;
  priceAfter: number;
  predictedUp: boolean;
  correct: boolean;
}

async function executePrediction(apiBase: string): Promise<PredictionResult> {
  const priceBefore = await fetchBtcPrice(apiBase);
  // predict up if price is above a round number (arbitrary demo heuristic)
  const predictedUp = priceBefore % 1000 > 500;

  console.log(`BTC price: $${priceBefore.toFixed(2)} — predicting ${predictedUp ? 'UP' : 'DOWN'}`);
  console.log('waiting 60s to re-check...');
  await new Promise((r) => setTimeout(r, 60_000));

  const priceAfter = await fetchBtcPrice(apiBase);
  const actualUp = priceAfter > priceBefore;
  const correct = predictedUp === actualUp;

  console.log(`BTC price after: $${priceAfter.toFixed(2)} — prediction ${correct ? 'CORRECT' : 'WRONG'}`);
  return { priceBefore, priceAfter, predictedUp, correct };
}

async function submitResult(
  market: Program<TaskMarket>,
  config: AgentConfig,
  operator: Keypair,
  agentPda: PublicKey,
  task: PendingTask,
  prediction: PredictionResult,
): Promise<void> {
  const resultPayload = JSON.stringify(prediction);
  const resultHash = createHash('sha256').update(resultPayload).digest();

  // placeholder proof key — in production, call the proof-gen service here:
  //   POST /prove { taskId, resultHash, agentDid, ... }
  // and receive a Groth16 proof + vk reference back.
  const proofKey = createHash('sha256').update('demo-proof-placeholder').digest();

  const ix = await buildSubmitResultIx(market, config.cluster, {
    operator: operator.publicKey,
    task: task.pubkey,
    agentAccount: agentPda,
    resultHash: Uint8Array.from(resultHash),
    proofKey: Uint8Array.from(proofKey),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(market.provider.connection, tx, [operator]);
  console.log(`result submitted for task ${task.pubkey.toBase58()}`);
}

async function main() {
  const config = loadConfig();
  const keypair = loadKeypair(config.keypairPath);
  const connection = new Connection(config.cluster.endpoint, 'confirmed');
  const provider = buildProvider(connection, keypair);

  const registry = agentRegistryProgram(provider, config.cluster);
  const market = taskMarketProgram(provider, config.cluster);

  const agentId = encodeAgentId('prediction-market-agent-v1');
  const agentPda = await ensureRegistered(registry, config, keypair, agentId);

  console.log(`polling for tasks every ${config.pollIntervalMs}ms...`);

  // single-pass demo: poll once, handle first matching task, then exit.
  // wrap in setInterval for a long-running agent.
  const tick = async () => {
    const tasks = await pollTasks(market, config.capabilityBit);
    if (tasks.length === 0) {
      console.log('no matching tasks found');
      return;
    }

    const task = tasks[0];
    console.log(`found task: ${task.pubkey.toBase58()}`);

    try {
      // 1. commit bid
      const { nonce, amount } = await commitBid(market, config, keypair, agentId, task);

      // 2. reveal bid (in production, wait for commit phase to close)
      await revealBid(market, keypair, task, amount, nonce);

      // 3. execute prediction
      const prediction = await executePrediction(config.priceApiBase);

      // 4. submit result
      await submitResult(market, config, keypair, agentPda, task, prediction);

      console.log('task lifecycle complete');
    } catch (err) {
      console.error('task execution failed:', err);
    }
  };

  await tick();

  // uncomment for continuous polling:
  // setInterval(tick, config.pollIntervalMs);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
