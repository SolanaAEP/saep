import { createHash, randomBytes } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { AnchorProvider, type Wallet } from '@coral-xyz/anchor';
import {
  resolveCluster,
  taskMarketProgram,
  buildCreateTaskIx,
  buildFundTaskIx,
  buildSubmitResultIx,
  buildReleaseIx,
  agentAccountPda,
  taskPda,
  type ClusterConfig,
} from '@saep/sdk';
import bs58 from 'bs58';
import type { Redis } from 'ioredis';
import { convertXrpToLamports } from './price-oracle.js';
import { bridgeRequests, bridgeDuration } from './metrics.js';
import type { ValidatedPayment } from './xrpl-listener.js';

export type SettlementStatus = 'pending' | 'settled' | 'failed';

export interface SettlementResult {
  txHash: string;
  solTxSig: string;
  lamports: bigint;
  status: SettlementStatus;
}

const REDIS_PREFIX = 'xrpl-bridge:settlement:';
const REDIS_TTL = 86400 * 7;

export async function checkIdempotency(
  redis: Redis,
  xrplTxHash: string,
): Promise<SettlementResult | null> {
  const raw = await redis.get(`${REDIS_PREFIX}${xrplTxHash}`);
  if (!raw) return null;
  const data = JSON.parse(raw) as { solTxSig: string; lamports: string; status: SettlementStatus };
  return {
    txHash: xrplTxHash,
    solTxSig: data.solTxSig,
    lamports: BigInt(data.lamports),
    status: data.status,
  };
}

async function recordSettlement(
  redis: Redis,
  xrplTxHash: string,
  result: SettlementResult,
): Promise<void> {
  await redis.set(
    `${REDIS_PREFIX}${xrplTxHash}`,
    JSON.stringify({
      solTxSig: result.solTxSig,
      lamports: result.lamports.toString(),
      status: result.status,
    }),
    'EX',
    REDIS_TTL,
  );
}

function loadKeypair(b58: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(b58));
}

function anchorProvider(connection: Connection, keypair: Keypair): AnchorProvider {
  const wallet: Wallet = {
    payer: keypair,
    publicKey: keypair.publicKey,
    signTransaction: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(tx: T) => tx,
    signAllTransactions: async <T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(txs: T[]) => txs,
  };
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

export async function settle(
  redis: Redis,
  payment: ValidatedPayment,
  gatewayKeypairB58: string,
  solanaRpcUrl: string,
  cluster: 'mainnet-beta' | 'devnet' | 'localnet',
): Promise<SettlementResult> {
  const end = bridgeDuration.startTimer();

  const existing = await checkIdempotency(redis, payment.txHash);
  if (existing) {
    bridgeRequests.inc({ status: 'idempotent' });
    end({ status: 'idempotent' });
    return existing;
  }

  const lamports = await convertXrpToLamports(payment.drops);

  if (cluster === 'localnet') {
    const result = await simulateSettlement(payment, lamports);
    await recordSettlement(redis, payment.txHash, result);
    bridgeRequests.inc({ status: 'settled' });
    end({ status: 'settled' });
    return result;
  }

  if (cluster === 'mainnet-beta') {
    throw new Error('mainnet settlement requires Jito bundle path');
  }

  const connection = new Connection(solanaRpcUrl, 'confirmed');
  const gatewayKp = loadKeypair(gatewayKeypairB58);
  const config = resolveCluster({ cluster: 'devnet', endpoint: solanaRpcUrl });

  try {
    const tx = await buildSettlementTx(
      connection,
      gatewayKp,
      config,
      payment,
      lamports,
    );
    tx.sign(gatewayKp);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(sig, 'confirmed');

    const result: SettlementResult = {
      txHash: payment.txHash,
      solTxSig: sig,
      lamports,
      status: 'settled',
    };
    await recordSettlement(redis, payment.txHash, result);
    bridgeRequests.inc({ status: 'settled' });
    end({ status: 'settled' });
    return result;
  } catch (err) {
    const failResult: SettlementResult = {
      txHash: payment.txHash,
      solTxSig: '',
      lamports,
      status: 'failed',
    };
    await recordSettlement(redis, payment.txHash, failResult);
    bridgeRequests.inc({ status: 'failed' });
    end({ status: 'failed' });
    throw err;
  }
}

async function buildSettlementTx(
  connection: Connection,
  gatewayKp: Keypair,
  config: ClusterConfig,
  payment: ValidatedPayment,
  lamports: bigint,
): Promise<Transaction> {
  const provider = anchorProvider(connection, gatewayKp);
  const program = taskMarketProgram(provider, config);

  const taskNonce = randomBytes(8);
  const agentDidBytes = Buffer.from(payment.agentDid.padEnd(64, '0').slice(0, 64), 'hex');
  const argsHash = createHash('sha256').update(payment.txHash).digest();
  const recipient = new PublicKey(payment.solanaPubkey);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const ixs: TransactionInstruction[] = [];

  ixs.push(await buildCreateTaskIx(program, config, {
    client: gatewayKp.publicKey,
    taskNonce,
    agentDid: agentDidBytes,
    agentOperator: recipient,
    agentId: agentDidBytes.subarray(0, 16),
    paymentMint: PublicKey.default,
    paymentAmount: lamports,
    taskHash: argsHash.subarray(0, 32),
    criteriaRoot: new Uint8Array(32),
    deadline,
    milestoneCount: 1,
  }));

  const [taskAddr] = taskPda(program.programId, gatewayKp.publicKey, taskNonce);

  ixs.push(await buildFundTaskIx(program, {
    client: gatewayKp.publicKey,
    task: taskAddr,
    paymentMint: PublicKey.default,
    clientTokenAccount: gatewayKp.publicKey,
  }));

  const [agentAccount] = agentAccountPda(
    config.programIds.agentRegistry,
    recipient,
    agentDidBytes.subarray(0, 16),
  );

  ixs.push(await buildSubmitResultIx(program, config, {
    operator: recipient,
    task: taskAddr,
    agentAccount,
    resultHash: argsHash.subarray(0, 32),
    proofKey: new Uint8Array(32),
  }));

  ixs.push(await buildReleaseIx(program, config, {
    cranker: gatewayKp.publicKey,
    task: taskAddr,
    paymentMint: PublicKey.default,
    agentTokenAccount: recipient,
    feeCollectorTokenAccount: gatewayKp.publicKey,
    solrepPoolTokenAccount: gatewayKp.publicKey,
    agentAccount,
    client: gatewayKp.publicKey,
  }));

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = gatewayKp.publicKey;
  tx.add(...ixs);
  return tx;
}

async function simulateSettlement(
  payment: ValidatedPayment,
  lamports: bigint,
): Promise<SettlementResult> {
  const h = createHash('sha256');
  h.update(`xrpl-bridge:${payment.txHash}`);
  return {
    txHash: payment.txHash,
    solTxSig: h.digest('base64url'),
    lamports,
    status: 'settled',
  };
}

export async function getStatus(
  redis: Redis,
  txHash: string,
): Promise<SettlementResult | null> {
  return checkIdempotency(redis, txHash);
}
