import { createHash, randomBytes } from 'node:crypto';
import { BN, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  fetchAgentByDid,
  marketGlobalPda,
  resolveCluster,
  taskEscrowPda,
  taskMarketProgram,
  taskPda,
} from '@saep/sdk';
import type { Config } from './config.js';

type SettlementConfigInput = Pick<
  Config,
  'cluster' | 'solanaRpcUrl' | 'keypair' | 'taskMarketProgramId' | 'agentRegistryProgramId'
>;

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
  task?: string;
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
  task?: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function decodeBase58Key(label: string, value: string): Uint8Array {
  try {
    return new PublicKey(value).toBytes();
  } catch {
    throw new Error(`${label} must be a valid base58-encoded public key`);
  }
}

function firstCapabilityBit(mask: bigint): number {
  for (let bit = 0; bit < 128; bit++) {
    if ((mask & (1n << BigInt(bit))) !== 0n) return bit;
  }
  throw new Error('recipient agent advertises no capabilities');
}

function bnToNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 'toString' in value) {
    return Number((value as { toString(): string }).toString());
  }
  throw new Error('unable to convert value to number');
}

async function currentClusterTime(connection: Connection): Promise<number> {
  const slot = await connection.getSlot('confirmed');
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

async function resolveTokenProgram(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info) throw new Error(`payment mint ${mint.toBase58()} was not found`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`payment mint ${mint.toBase58()} is not an SPL token mint`);
}

async function simulateSettlement(
  payment: PaymentDetails,
  requesterDid: string,
  argsHash: string,
): Promise<SettlementResult> {
  const h = createHash('sha256');
  h.update(
    JSON.stringify({
      kind: 'x402_settlement',
      requesterDid,
      payment,
      argsHash,
    }),
  );
  return {
    tx_sig: `localnet_${h.digest('hex').slice(0, 24)}`,
    amount: payment.amount,
    mint: payment.mint,
  };
}

export function settleViaTaskMarket(
  cfg: Config,
  payment: PaymentDetails,
  requesterDid: string,
  argsHash: string,
  budgetLamports: number,
): Promise<SettlementResult>;
export function settleViaTaskMarket(
  rpcUrl: string,
  cluster: SettlementConfigInput['cluster'],
  payment: PaymentDetails,
  requesterDid: string,
  argsHash: string,
  budgetLamports: number,
): Promise<SettlementResult>;
export async function settleViaTaskMarket(
  cfgOrRpcUrl: Config | string,
  paymentOrCluster: PaymentDetails | SettlementConfigInput['cluster'],
  requesterDidOrPayment: string | PaymentDetails,
  argsHashOrRequesterDid: string,
  budgetOrArgsHash: number | string,
  maybeBudgetLamports?: number,
): Promise<SettlementResult> {
  const normalized: {
    cfg: SettlementConfigInput;
    payment: PaymentDetails;
    requesterDid: string;
    argsHash: string;
    budgetLamports: number;
  } = typeof cfgOrRpcUrl === 'string'
    ? {
        cfg: {
          solanaRpcUrl: cfgOrRpcUrl,
          cluster: paymentOrCluster as SettlementConfigInput['cluster'],
          keypair: null,
          taskMarketProgramId: undefined,
          agentRegistryProgramId: undefined,
        },
        payment: requesterDidOrPayment as PaymentDetails,
        requesterDid: argsHashOrRequesterDid,
        argsHash: budgetOrArgsHash as string,
        budgetLamports: maybeBudgetLamports ?? 0,
      }
    : {
        cfg: cfgOrRpcUrl,
        payment: paymentOrCluster as PaymentDetails,
        requesterDid: requesterDidOrPayment as string,
        argsHash: argsHashOrRequesterDid,
        budgetLamports: budgetOrArgsHash as number,
      };

  const {
    cfg,
    payment,
    requesterDid,
    argsHash,
    budgetLamports,
  } = normalized;

  if (payment.amount > budgetLamports) {
    throw new Error(`payment ${payment.amount} exceeds budget ${budgetLamports}`);
  }

  if (cfg.cluster === 'localnet') {
    return simulateSettlement(payment, requesterDid, argsHash);
  }

  if (cfg.cluster === 'mainnet-beta') {
    throw new Error('mainnet settlement requires Jito bundle path — not yet wired');
  }

  if (!cfg.keypair) {
    throw new Error('SAEP_OPERATOR_KEYPAIR is required for live task_market settlement');
  }

  const clusterConfig = resolveCluster({
    cluster: cfg.cluster,
    endpoint: cfg.solanaRpcUrl,
    programIds: {
      ...(cfg.taskMarketProgramId ? { taskMarket: cfg.taskMarketProgramId } : {}),
      ...(cfg.agentRegistryProgramId ? { agentRegistry: cfg.agentRegistryProgramId } : {}),
    },
  });

  const connection = new Connection(cfg.solanaRpcUrl, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(cfg.keypair), {
    commitment: 'confirmed',
  });
  const agentRegistry = agentRegistryProgram(provider, clusterConfig);
  const taskMarket = taskMarketProgram(provider, clusterConfig);

  const recipientDidBytes = decodeBase58Key('payment recipient', payment.recipient);
  const recipient = await fetchAgentByDid(agentRegistry, bytesToHex(recipientDidBytes));
  if (!recipient) {
    throw new Error(`recipient DID ${payment.recipient} is not registered in agent_registry`);
  }
  if (recipient.status !== 'active') {
    throw new Error(`recipient DID ${payment.recipient} is not active`);
  }

  const requesterDidBytes = decodeBase58Key('requester DID', requesterDid);
  const paymentMint = new PublicKey(payment.mint);
  const tokenProgramId = await resolveTokenProgram(connection, paymentMint);
  const payerTokenAccount = getAssociatedTokenAddressSync(
    paymentMint,
    cfg.keypair.publicKey,
    true,
    tokenProgramId,
  );
  const payerTokenBalance = await connection.getTokenAccountBalance(payerTokenAccount, 'confirmed')
    .catch(() => null);
  if (!payerTokenBalance) {
    throw new Error(
      `payer token account ${payerTokenAccount.toBase58()} does not exist for mint ${paymentMint.toBase58()}`,
    );
  }
  if (BigInt(payerTokenBalance.value.amount) < BigInt(payment.amount)) {
    throw new Error(
      `payer token account ${payerTokenAccount.toBase58()} has insufficient balance for ${payment.amount}`,
    );
  }

  const marketGlobalAddress = marketGlobalPda(clusterConfig.programIds.taskMarket)[0];
  const marketGlobal = await taskMarket.account.marketGlobal.fetch(marketGlobalAddress) as {
    allowedPaymentMints: PublicKey[];
    maxDeadlineSecs: { toString(): string };
  };
  if (!marketGlobal.allowedPaymentMints.some((mint) => mint.equals(paymentMint))) {
    throw new Error(`payment mint ${paymentMint.toBase58()} is not allowed by task_market`);
  }

  const deadlineCeiling = bnToNumber(marketGlobal.maxDeadlineSecs);
  const deadlineOffset = Math.min(Math.max(120, 300), Math.max(61, deadlineCeiling - 1));
  if (deadlineOffset <= 60) {
    throw new Error('task_market maxDeadlineSecs is too small for x402 settlement');
  }
  const deadline = (await currentClusterTime(connection)) + deadlineOffset;
  const taskNonce = randomBytes(8);
  const capabilityBit = firstCapabilityBit(recipient.capabilityMask);
  const argsHashBytes = Uint8Array.from(Buffer.from(argsHash, 'hex'));
  const payload = {
    kind: { generic: { capabilityBit, argsHash: Array.from(argsHashBytes) } },
    capabilityBit,
    criteria: Buffer.from(requesterDidBytes),
    requiresPersonhood: { none: {} },
  };
  const [taskAddress] = taskPda(clusterConfig.programIds.taskMarket, cfg.keypair.publicKey, taskNonce);
  const [escrowAddress] = taskEscrowPda(clusterConfig.programIds.taskMarket, taskAddress);
  const [guardAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('guard')],
    clusterConfig.programIds.taskMarket,
  );

  const createIx = await taskMarket.methods
    .createTask(
      Array.from(taskNonce),
      Array.from(recipient.did),
      paymentMint,
      new BN(payment.amount),
      payload,
      Array(32).fill(0),
      new BN(deadline),
      1,
    )
    .accountsPartial({
      global: marketGlobalAddress,
      client: cfg.keypair.publicKey,
      agentRegistryProgram: clusterConfig.programIds.agentRegistry,
      agentAccount: recipient.address,
    })
    .instruction();

  const fundIx = await taskMarket.methods
    .fundTask()
    .accountsPartial({
      global: marketGlobalAddress,
      task: taskAddress,
      paymentMint,
      escrow: escrowAddress,
      clientTokenAccount: payerTokenAccount,
      hookAllowlist: null,
      guard: guardAddress,
      client: cfg.keypair.publicKey,
      tokenProgram: tokenProgramId,
    })
    .instruction();

  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({
    feePayer: cfg.keypair.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(createIx, fundIx);

  const txSig = await sendAndConfirmTransaction(connection, tx, [cfg.keypair], {
    commitment: 'confirmed',
  });

  const task = await taskMarket.account.taskContract.fetch(taskAddress) as {
    status: Record<string, unknown>;
  };
  if (!('funded' in task.status)) {
    throw new Error(`task ${taskAddress.toBase58()} was created but did not reach funded status`);
  }

  return {
    tx_sig: txSig,
    amount: payment.amount,
    mint: payment.mint,
    task: taskAddress.toBase58(),
  };
}

export type TxStatus = 'confirmed' | 'finalized' | 'not_found' | 'failed';

export async function verifySettlement(
  rpcUrl: string,
  txSig: string,
): Promise<{ status: TxStatus; slot?: number; err?: string }> {
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
