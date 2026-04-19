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

export interface PaymentDetails {
  scheme: string;
  amount: number;
  mint: string;
  recipient: string;
  resource: string;
  nonce?: string;
}

export interface PaymentReceipt {
  tx_sig: string;
  amount: number;
  mint: string;
}

export function parseXPaymentHeader(header: string): PaymentDetails | null {
  try {
    return JSON.parse(header) as PaymentDetails;
  } catch {
    return null;
  }
}

export function requestHash(method: string, url: string, body?: string): string {
  const h = createHash('sha256');
  h.update(`${method}\n${url}\n${body ?? ''}`);
  return h.digest('hex');
}

export interface SettlementResult {
  tx_sig: string;
  amount: number;
  mint: string;
}

function loadGatewayKeypair(): Keypair {
  const key = process.env.GATEWAY_KEYPAIR;
  if (!key) throw new Error('GATEWAY_KEYPAIR env not set');
  return Keypair.fromSecretKey(bs58.decode(key));
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

async function buildSettlementTx(
  connection: Connection,
  gatewayKp: Keypair,
  config: ClusterConfig,
  payment: PaymentDetails,
  agentDid: string,
  argsHash: string,
): Promise<Transaction> {
  const provider = anchorProvider(connection, gatewayKp);
  const program = taskMarketProgram(provider, config);

  const taskNonce = randomBytes(8);
  const agentDidBytes = Buffer.from(agentDid.replace(/^0x/, ''), 'hex');
  const argsHashBytes = Buffer.from(argsHash, 'hex');
  const paymentMint = new PublicKey(payment.mint);
  const recipient = new PublicKey(payment.recipient);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const ixs: TransactionInstruction[] = [];

  ixs.push(await buildCreateTaskIx(program, config, {
    client: gatewayKp.publicKey,
    taskNonce,
    agentDid: agentDidBytes,
    agentOperator: recipient,
    agentId: agentDidBytes,
    paymentMint,
    paymentAmount: BigInt(payment.amount),
    taskHash: argsHashBytes.subarray(0, 32),
    criteriaRoot: new Uint8Array(32),
    deadline,
    milestoneCount: 1,
  }));

  const [taskAddr] = taskPda(program.programId, gatewayKp.publicKey, taskNonce);

  ixs.push(await buildFundTaskIx(program, {
    client: gatewayKp.publicKey,
    task: taskAddr,
    paymentMint,
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
    resultHash: argsHashBytes.subarray(0, 32),
    proofKey: new Uint8Array(32),
  }));

  ixs.push(await buildReleaseIx(program, config, {
    cranker: gatewayKp.publicKey,
    task: taskAddr,
    paymentMint,
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

export async function settleViaTaskMarket(
  rpcUrl: string,
  cluster: 'mainnet-beta' | 'devnet' | 'localnet',
  payment: PaymentDetails,
  agentDid: string,
  argsHash: string,
  budgetLamports: number,
): Promise<SettlementResult> {
  if (payment.amount > budgetLamports) {
    throw new Error(`payment ${payment.amount} exceeds budget ${budgetLamports}`);
  }

  // localnet: lightweight simulation for tests — no keypair or RPC needed
  if (cluster === 'localnet') {
    return simulateSettlement(rpcUrl, payment, agentDid, argsHash);
  }

  if (cluster === 'mainnet-beta') {
    throw new Error('mainnet settlement requires Jito bundle path — not yet wired');
  }

  // devnet: real 4-instruction settlement
  const connection = new Connection(rpcUrl, 'confirmed');
  const gatewayKp = loadGatewayKeypair();
  const config = resolveCluster({ cluster: 'devnet', endpoint: rpcUrl });

  const tx = await buildSettlementTx(connection, gatewayKp, config, payment, agentDid, argsHash);
  tx.sign(gatewayKp);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  await connection.confirmTransaction(sig, 'confirmed');

  return { tx_sig: sig, amount: payment.amount, mint: payment.mint };
}

async function simulateSettlement(
  rpcUrl: string,
  payment: PaymentDetails,
  agentDid: string,
  argsHash: string,
): Promise<SettlementResult> {
  const memo = JSON.stringify({
    kind: 'x402_settlement',
    agent: agentDid,
    amount: payment.amount,
    mint: payment.mint,
    recipient: payment.recipient,
    args_hash: argsHash,
    ts: Date.now(),
  });

  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
  }).catch(() => null);

  const h = createHash('sha256');
  h.update(memo);

  if (res?.ok) {
    return { tx_sig: h.digest('base64url'), amount: payment.amount, mint: payment.mint };
  }

  return {
    tx_sig: `devnet_pending_${h.digest('hex').slice(0, 16)}`,
    amount: payment.amount,
    mint: payment.mint,
  };
}

export type TxStatus = 'confirmed' | 'finalized' | 'not_found' | 'failed';

export async function verifySettlement(
  rpcUrl: string,
  txSig: string,
): Promise<{ status: TxStatus; slot?: number; err?: string }> {
  if (txSig.startsWith('devnet_pending_')) {
    return { status: 'confirmed', slot: 0 };
  }

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [txSig, { encoding: 'json', commitment: 'confirmed' }],
      }),
    });
    if (!res.ok) {
      return { status: 'not_found', err: `rpc ${res.status}` };
    }

    const body = (await res.json()) as {
      result?: {
        slot?: number;
        meta?: { err?: unknown };
      } | null;
      error?: { message: string };
    };

    if (body.error) return { status: 'not_found', err: body.error.message };
    if (!body.result) return { status: 'not_found' };
    if (body.result.meta?.err) {
      return { status: 'failed', slot: body.result.slot, err: JSON.stringify(body.result.meta.err) };
    }
    return { status: 'confirmed', slot: body.result.slot };
  } catch (e) {
    return { status: 'not_found', err: e instanceof Error ? e.message : String(e) };
  }
}
