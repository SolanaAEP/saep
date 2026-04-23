import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BN, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  agentRegistryProgram,
  buildReleaseIx,
  buildSubmitResultIx,
  buildVerifyTaskIx,
  fetchAgentByDid,
  marketGlobalPda,
  resolveCluster,
  taskEscrowPda,
  taskMarketProgram,
  taskPda,
  verifierKeyPda,
} from '@saep/sdk';
import type { Config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = resolve(__dirname, '../../../circuits');
const SAMPLE_INPUT_PATH = resolve(CIRCUITS_DIR, 'task_completion/inputs/sample_input.json');
const WASM_PATH = resolve(CIRCUITS_DIR, 'task_completion/build/task_completion_js/task_completion.wasm');
const ZKEY_PATH = resolve(CIRCUITS_DIR, 'task_completion/build/task_completion.zkey');
const VK_LABEL = 'task_completion_v1';
const RESULT_TAG = BigInt(0x52534c54);
const BN254_SCALAR_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

type SettlementConfigInput = Pick<
  Config,
  | 'cluster'
  | 'solanaRpcUrl'
  | 'keypair'
  | 'recipientKeypair'
  | 'taskDeadlineSecs'
  | 'taskMarketProgramId'
  | 'agentRegistryProgramId'
>;

type SampleInput = {
  task_hash: string;
  result_hash: string;
  deadline: string;
  submitted_at: string;
  criteria_root: string;
  task_preimage: string[];
  result_preimage: string[];
  salt: string;
  criteria_satisfied: string[];
  criteria_path: string[];
  criteria_index: string[];
};

type SnarkProof = {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
};

type TaskAccountState = {
  taskId: number[];
  taskHash: number[];
  resultHash: number[];
  criteriaRoot: number[];
  deadline: { toString(): string };
  submittedAt: { toString(): string };
  disputeWindowEnd: { toString(): string };
  paymentMint: PublicKey;
  client: PublicKey;
  agentDid: number[];
  status: Record<string, unknown>;
};

type VerificationResult = {
  status: TxStatus;
  slot?: number;
  err?: string;
  task?: string;
  task_id_hex?: string;
  task_status?: string;
};

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
  task_id_hex?: string;
  task_status?: string;
}

export interface UpstreamResponseSnapshot {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SettlementResult {
  tx_sig: string;
  amount: number;
  mint: string;
  task?: string;
  task_id_hex?: string;
  task_status?: string;
}

let poseidonPromise: Promise<Awaited<ReturnType<typeof buildPoseidon>>> | null = null;
let sampleInputCache: SampleInput | null = null;

function getPoseidon() {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon();
  }
  return poseidonPromise;
}

function loadSampleInput(): SampleInput {
  if (sampleInputCache) return sampleInputCache;
  if (!existsSync(SAMPLE_INPUT_PATH)) {
    throw new Error(`sample circuit input missing: ${SAMPLE_INPUT_PATH}`);
  }
  sampleInputCache = JSON.parse(readFileSync(SAMPLE_INPUT_PATH, 'utf8')) as SampleInput;
  return sampleInputCache;
}

function requireProofArtifacts(): void {
  if (!existsSync(WASM_PATH)) throw new Error(`proof wasm missing: ${WASM_PATH}`);
  if (!existsSync(ZKEY_PATH)) throw new Error(`proof zkey missing: ${ZKEY_PATH}`);
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

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
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

function parseTaskStatus(status: Record<string, unknown>): string {
  return Object.keys(status)[0] ?? 'unknown';
}

function isDisputeWindowOpen(error: unknown): boolean {
  return error instanceof Error && error.message.includes('DisputeWindowOpen');
}

function configuredProvider(connection: Connection, keypair: Keypair): AnchorProvider {
  return new AnchorProvider(connection, new Wallet(keypair), {
    commitment: 'confirmed',
    preflightCommitment: 'processed',
    maxRetries: 5,
  });
}

async function currentClusterTime(connection: Connection): Promise<number> {
  const slot = await connection.getSlot('confirmed');
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForDisputeWindow(
  connection: Connection,
  endTs: bigint,
): Promise<void> {
  while (true) {
    const now = BigInt(await currentClusterTime(connection));
    if (now >= endTs) return;
    const remaining = Number(endTs - now + 1n);
    console.log(`[x402] waiting ${remaining}s for dispute window to close on cluster time...`);
    await sleep(Math.min(remaining, 5) * 1000);
  }
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

function fieldElementToBytes(value: string | bigint): Uint8Array {
  let n = typeof value === 'bigint' ? value : BigInt(value);
  const buf = Buffer.alloc(32);
  for (let i = 31; i >= 0; i -= 1) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

function bytesToDecimalString(bytes: Uint8Array | number[]): string {
  let acc = 0n;
  for (const byte of bytes) {
    acc = (acc << 8n) | BigInt(byte);
  }
  return acc.toString();
}

function canonicalFieldBytes(bytes: Uint8Array | number[]): Uint8Array {
  let acc = 0n;
  for (const byte of bytes) {
    acc = (acc << 8n) | BigInt(byte);
  }
  acc %= BN254_SCALAR_FIELD_MODULUS;
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return out;
}

function g1ToBytes(point: [string, string, string]): Uint8Array {
  return Uint8Array.from([...fieldElementToBytes(point[0]), ...fieldElementToBytes(point[1])]);
}

function g2ToBytes(point: [[string, string], [string, string], [string, string]]): Uint8Array {
  const xIm = fieldElementToBytes(point[0][1]);
  const xRe = fieldElementToBytes(point[0][0]);
  const yIm = fieldElementToBytes(point[1][1]);
  const yRe = fieldElementToBytes(point[1][0]);
  return Uint8Array.from([...xIm, ...xRe, ...yIm, ...yRe]);
}

function computeVkId(label: string): Uint8Array {
  return createHash('sha256').update(label).digest();
}

function responseDigest(snapshot: UpstreamResponseSnapshot): Buffer {
  const headerPairs = Object.entries(snapshot.headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256')
    .update(JSON.stringify([snapshot.status, headerPairs, snapshot.body]))
    .digest();
}

function responseResultPreimage(snapshot: UpstreamResponseSnapshot): bigint[] {
  return Array.from(responseDigest(snapshot), (byte) => BigInt(byte));
}

async function poseidonSponge(tag: bigint, inputs: bigint[], chunkSize = 15): Promise<bigint> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;
  const padded = Array.from(inputs);
  const nChunks = Math.ceil(padded.length / chunkSize);
  while (padded.length < nChunks * chunkSize) padded.push(0n);

  let state = tag;
  for (let c = 0; c < nChunks; c += 1) {
    const chunk = padded.slice(c * chunkSize, (c + 1) * chunkSize);
    state = BigInt(F.toString(poseidon([state, ...chunk])));
  }
  return state;
}

async function buildManagedWitness(
  rawTask: TaskAccountState,
  snapshot: UpstreamResponseSnapshot,
): Promise<{
  resultHash: Uint8Array;
  resultHashDecimal: string;
  proofKey: Uint8Array;
  witness: SampleInput;
}> {
  const sample = loadSampleInput();
  const resultPreimage = responseResultPreimage(snapshot);
  const resultHash = await poseidonSponge(RESULT_TAG, resultPreimage);
  const responseHash = responseDigest(snapshot);
  const proofKey = createHash('sha256')
    .update('saep:x402:proof')
    .update(responseHash)
    .update(Uint8Array.from(rawTask.taskId))
    .digest();

  return {
    resultHash: fieldElementToBytes(resultHash),
    resultHashDecimal: resultHash.toString(),
    proofKey: Uint8Array.from(proofKey),
    witness: {
      ...sample,
      task_hash: bytesToDecimalString(canonicalFieldBytes(Uint8Array.from(rawTask.taskHash))),
      result_hash: resultHash.toString(),
      deadline: rawTask.deadline.toString(),
      submitted_at: rawTask.submittedAt.toString(),
      criteria_root: bytesToDecimalString(canonicalFieldBytes(Uint8Array.from(rawTask.criteriaRoot))),
      result_preimage: resultPreimage.map((value) => value.toString()),
    },
  };
}

async function generateGroth16Proof(witness: SampleInput): Promise<SnarkProof> {
  requireProofArtifacts();
  const { proof } = await snarkjs.groth16.fullProve(witness, WASM_PATH, ZKEY_PATH);
  return proof as SnarkProof;
}

async function sendInstructions(
  connection: Connection,
  label: string,
  feePayer: Keypair,
  extraSigners: Keypair[],
  instructions: TransactionInstruction[],
): Promise<string> {
  let lastError: unknown;
  const seen = new Set<string>();
  const signers = [feePayer, ...extraSigners].filter((signer) => {
    const key = signer.publicKey.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({
        feePayer: feePayer.publicKey,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }).add(...instructions);
      return await sendAndConfirmTransaction(connection, tx, signers, {
        commitment: 'confirmed',
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('Blockhash not found') || attempt === 4) {
        throw error;
      }
      console.warn(`[x402] ${label}: blockhash expired during preflight, retrying (${attempt}/4)...`);
      await sleep(attempt * 400);
    }
  }

  throw lastError;
}

function normalizedClusterConfig(cfg: SettlementConfigInput) {
  return resolveCluster({
    cluster: cfg.cluster,
    endpoint: cfg.solanaRpcUrl,
    programIds: {
      ...(cfg.taskMarketProgramId ? { taskMarket: cfg.taskMarketProgramId } : {}),
      ...(cfg.agentRegistryProgramId ? { agentRegistry: cfg.agentRegistryProgramId } : {}),
    },
  });
}

async function fetchTaskState(
  cfg: SettlementConfigInput,
  taskAddress: string,
): Promise<{ connection: Connection; task: TaskAccountState | null }> {
  const clusterConfig = normalizedClusterConfig(cfg);
  const connection = new Connection(cfg.solanaRpcUrl, 'confirmed');
  const provider = configuredProvider(connection, cfg.keypair ?? Keypair.generate());
  const taskMarket = taskMarketProgram(provider, clusterConfig);
  const task = (await taskMarket.account.taskContract.fetchNullable(new PublicKey(taskAddress))) as TaskAccountState | null;
  return { connection, task };
}

function resolveManagedRecipientSigner(
  cfg: Config,
  expectedOperator: PublicKey,
): Keypair | null {
  if (cfg.recipientKeypair && cfg.recipientKeypair.publicKey.equals(expectedOperator)) {
    return cfg.recipientKeypair;
  }
  if (cfg.keypair && cfg.keypair.publicKey.equals(expectedOperator)) {
    return cfg.keypair;
  }
  return null;
}

async function refreshReceiptStatus(
  cfg: SettlementConfigInput,
  receipt: PaymentReceipt,
): Promise<PaymentReceipt> {
  if (!receipt.task || cfg.cluster === 'localnet') return receipt;
  const { task } = await fetchTaskState(cfg, receipt.task);
  if (!task) return receipt;
  return {
    ...receipt,
    task_id_hex: receipt.task_id_hex ?? bytesToHex(Uint8Array.from(task.taskId)),
    task_status: parseTaskStatus(task.status),
  };
}

async function releaseAfterDisputeWindow(
  connection: Connection,
  cfg: Config,
  task: TaskAccountState,
  taskAddress: PublicKey,
  agentAccountAddress: PublicKey,
  agentOperator: PublicKey,
): Promise<string> {
  if (!cfg.keypair) throw new Error('SAEP_OPERATOR_KEYPAIR is required for release');

  const clusterConfig = normalizedClusterConfig(cfg);
  const tokenProgramId = await resolveTokenProgram(connection, task.paymentMint);
  const provider = configuredProvider(connection, cfg.keypair);
  const taskMarket = taskMarketProgram(provider, clusterConfig);
  const marketGlobalAddress = marketGlobalPda(clusterConfig.programIds.taskMarket)[0];
  const marketGlobal = await taskMarket.account.marketGlobal.fetch(marketGlobalAddress) as {
    feeCollector: PublicKey;
    solrepPool: PublicKey;
  };

  const agentTokenAccount = getAssociatedTokenAddressSync(
    task.paymentMint,
    agentOperator,
    true,
    tokenProgramId,
  );
  const feeCollectorTokenAccount = getAssociatedTokenAddressSync(
    task.paymentMint,
    marketGlobal.feeCollector,
    true,
    tokenProgramId,
  );
  const solrepPoolTokenAccount = getAssociatedTokenAddressSync(
    task.paymentMint,
    marketGlobal.solrepPool,
    true,
    tokenProgramId,
  );

  await waitForDisputeWindow(connection, BigInt(task.disputeWindowEnd.toString()));

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const ix = await buildReleaseIx(taskMarket, clusterConfig, {
        cranker: cfg.keypair.publicKey,
        task: taskAddress,
        paymentMint: task.paymentMint,
        agentTokenAccount,
        feeCollectorTokenAccount,
        solrepPoolTokenAccount,
        agentAccount: agentAccountAddress,
        client: task.client,
        tokenProgramId,
      });
      return await sendInstructions(connection, 'x402_release', cfg.keypair, [], [ix]);
    } catch (error) {
      if (!isDisputeWindowOpen(error) || attempt === 6) {
        throw error;
      }
      const now = BigInt(await currentClusterTime(connection));
      const end = BigInt(task.disputeWindowEnd.toString());
      const remaining = end > now ? Number(end - now + 2n) : 2;
      console.warn(
        `[x402] release hit DisputeWindowOpen on attempt ${attempt}; waiting ${remaining}s for cluster time to catch up...`,
      );
      await sleep(Math.min(Math.max(remaining, 2), 10) * 1000);
    }
  }

  throw new Error('release retry loop exhausted unexpectedly');
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
          recipientKeypair: null,
          taskDeadlineSecs: 300,
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

  const sample = loadSampleInput();
  const clusterConfig = normalizedClusterConfig(cfg);
  const connection = new Connection(cfg.solanaRpcUrl, 'confirmed');
  const provider = configuredProvider(connection, cfg.keypair);
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
  const requestedDeadlineSecs = Math.max(61, cfg.taskDeadlineSecs);
  const deadlineOffset = Math.min(requestedDeadlineSecs, Math.max(61, deadlineCeiling - 1));
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
      Array.from(fieldElementToBytes(sample.criteria_root)),
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

  const txSig = await sendInstructions(connection, 'x402_settle', cfg.keypair, [], [createIx, fundIx]);

  const task = await taskMarket.account.taskContract.fetch(taskAddress) as TaskAccountState;
  const taskStatus = parseTaskStatus(task.status);
  if (!('funded' in task.status)) {
    throw new Error(`task ${taskAddress.toBase58()} was created but did not reach funded status`);
  }

  return {
    tx_sig: txSig,
    amount: payment.amount,
    mint: payment.mint,
    task: taskAddress.toBase58(),
    task_id_hex: bytesToHex(Uint8Array.from(task.taskId)),
    task_status: taskStatus,
  };
}

export async function finalizeManagedSettlement(
  cfg: Config,
  receipt: PaymentReceipt,
  upstream: UpstreamResponseSnapshot,
): Promise<PaymentReceipt> {
  const refreshed = await refreshReceiptStatus(cfg, receipt);
  if (cfg.cluster === 'localnet' || !cfg.keypair || !refreshed.task) {
    return refreshed;
  }

  const clusterConfig = normalizedClusterConfig(cfg);
  const connection = new Connection(cfg.solanaRpcUrl, 'confirmed');
  const payerProvider = configuredProvider(connection, cfg.keypair);
  const taskMarketPayer = taskMarketProgram(payerProvider, clusterConfig);
  const agentRegistryPayer = agentRegistryProgram(payerProvider, clusterConfig);
  const taskAddress = new PublicKey(refreshed.task);

  let task = (await taskMarketPayer.account.taskContract.fetchNullable(taskAddress)) as TaskAccountState | null;
  if (!task) return refreshed;

  let taskStatus = parseTaskStatus(task.status);
  if (taskStatus === 'released') {
    return {
      ...refreshed,
      task_id_hex: refreshed.task_id_hex ?? bytesToHex(Uint8Array.from(task.taskId)),
      task_status: taskStatus,
    };
  }

  const agentDidHex = bytesToHex(Uint8Array.from(task.agentDid));
  const recipient = await fetchAgentByDid(agentRegistryPayer, agentDidHex);
  if (!recipient) {
    return {
      ...refreshed,
      task_status: taskStatus,
    };
  }

  const managedRecipient = resolveManagedRecipientSigner(cfg, recipient.operator);
  if (!managedRecipient) {
    return {
      ...refreshed,
      task_status: taskStatus,
    };
  }

  if (taskStatus === 'funded') {
    const witnessSeed = await buildManagedWitness(task, upstream);
    const recipientProvider = configuredProvider(connection, managedRecipient);
    const taskMarketRecipient = taskMarketProgram(recipientProvider, clusterConfig);
    const submitIx = await buildSubmitResultIx(taskMarketRecipient, clusterConfig, {
      operator: managedRecipient.publicKey,
      task: taskAddress,
      agentAccount: recipient.address,
      resultHash: witnessSeed.resultHash,
      proofKey: witnessSeed.proofKey,
    });
    await sendInstructions(connection, 'x402_submit_result', cfg.keypair, [managedRecipient], [submitIx]);
    task = await taskMarketPayer.account.taskContract.fetch(taskAddress) as TaskAccountState;
    taskStatus = parseTaskStatus(task.status);
  }

  if (taskStatus === 'proofSubmitted') {
    const witness = await buildManagedWitness(task, upstream);
    const proof = await generateGroth16Proof(witness.witness);
    const vkId = computeVkId(VK_LABEL);
    const verifierKey = verifierKeyPda(clusterConfig.programIds.proofVerifier, vkId)[0];
    const verifyIx = await buildVerifyTaskIx(taskMarketPayer, clusterConfig, {
      cranker: cfg.keypair.publicKey,
      task: taskAddress,
      verifierKey,
      vkId,
      proofA: g1ToBytes(proof.pi_a),
      proofB: g2ToBytes(proof.pi_b),
      proofC: g1ToBytes(proof.pi_c),
    });
    await sendInstructions(connection, 'x402_verify_task', cfg.keypair, [], [verifyIx]);
    task = await taskMarketPayer.account.taskContract.fetch(taskAddress) as TaskAccountState;
    taskStatus = parseTaskStatus(task.status);
  }

  if (taskStatus === 'verified') {
    await releaseAfterDisputeWindow(
      connection,
      cfg,
      task,
      taskAddress,
      recipient.address,
      recipient.operator,
    );
    task = await taskMarketPayer.account.taskContract.fetch(taskAddress) as TaskAccountState;
    taskStatus = parseTaskStatus(task.status);
  }

  return {
    ...refreshed,
    task_id_hex: refreshed.task_id_hex ?? bytesToHex(Uint8Array.from(task.taskId)),
    task_status: taskStatus,
  };
}

export type TxStatus = 'confirmed' | 'finalized' | 'not_found' | 'failed';

export function verifySettlement(
  cfg: Config,
  receipt: Pick<PaymentReceipt, 'tx_sig' | 'task' | 'task_id_hex'>,
): Promise<VerificationResult>;
export function verifySettlement(
  rpcUrl: string,
  txSig: string,
): Promise<VerificationResult>;
export async function verifySettlement(
  cfgOrRpcUrl: Config | string,
  receiptOrTxSig: Pick<PaymentReceipt, 'tx_sig' | 'task' | 'task_id_hex'> | string,
): Promise<VerificationResult> {
  const cfg = typeof cfgOrRpcUrl === 'string' ? null : cfgOrRpcUrl;
  const rpcUrl = typeof cfgOrRpcUrl === 'string' ? cfgOrRpcUrl : cfgOrRpcUrl.solanaRpcUrl;
  const receipt = typeof receiptOrTxSig === 'string'
    ? { tx_sig: receiptOrTxSig }
    : receiptOrTxSig;

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [receipt.tx_sig, { encoding: 'json', commitment: 'confirmed' }],
      }),
    });
    if (!res.ok) {
      return { status: 'not_found', err: `rpc ${res.status}`, task: receipt.task, task_id_hex: receipt.task_id_hex };
    }

    const body = (await res.json()) as {
      result?: {
        slot?: number;
        meta?: { err?: unknown };
      } | null;
      error?: { message: string };
    };

    if (body.error) {
      return { status: 'not_found', err: body.error.message, task: receipt.task, task_id_hex: receipt.task_id_hex };
    }
    if (!body.result) {
      return { status: 'not_found', task: receipt.task, task_id_hex: receipt.task_id_hex };
    }
    if (body.result.meta?.err) {
      return {
        status: 'failed',
        slot: body.result.slot,
        err: JSON.stringify(body.result.meta.err),
        task: receipt.task,
        task_id_hex: receipt.task_id_hex,
      };
    }

    let taskStatus: string | undefined;
    let taskIdHex = receipt.task_id_hex;
    if (cfg && receipt.task) {
      const refreshed = await refreshReceiptStatus(cfg, {
        tx_sig: receipt.tx_sig,
        amount: 0,
        mint: '',
        task: receipt.task,
        task_id_hex: receipt.task_id_hex,
      });
      taskStatus = refreshed.task_status;
      taskIdHex = refreshed.task_id_hex;
    }

    return {
      status: 'confirmed',
      slot: body.result.slot,
      task: receipt.task,
      task_id_hex: taskIdHex,
      task_status: taskStatus,
    };
  } catch (error) {
    return {
      status: 'not_found',
      err: error instanceof Error ? error.message : String(error),
      task: receipt.task,
      task_id_hex: receipt.task_id_hex,
    };
  }
}
