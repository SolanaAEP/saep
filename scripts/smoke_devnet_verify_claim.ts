import * as anchor from '@coral-xyz/anchor';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  agentRegistryProgram,
  buildCreateTaskIx,
  buildFundTaskIx,
  buildRegisterAgentIx,
  buildSubmitResultIx,
  buildVerifyTaskIx,
  encodeAgentId,
  fetchAgentsByOperator,
  fetchMarketGlobal,
  resolveCluster,
  taskMarketProgram,
  taskPda,
  verifierKeyPda,
} from '@saep/sdk';
import { buildTools } from '../services/mcp-bridge/src/tools.js';
import { loadConfig } from '../services/mcp-bridge/src/config.js';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const CIRCUITS_DIR = resolve(__dirname, '../circuits');
const SAMPLE_INPUT_PATH = resolve(CIRCUITS_DIR, 'task_completion/inputs/sample_input.json');
const PROOF_JSON_PATH = resolve(CIRCUITS_DIR, 'task_completion/build/proof.json');
const VERIFY_JSON_PATH = resolve(CIRCUITS_DIR, 'task_completion/build/verification_key.json');
const DEFAULT_DEADLINE_LEAD_SECS = 90;
const DEFAULT_PAYMENT_AMOUNT = 2_000_000n; // 2 DTL @ 6 decimals
const DEFAULT_OPERATOR_LAMPORTS = 200_000_000n; // 0.2 SOL
const CLAIM_TOOL_NAME = 'claim_payout';
const VK_LABEL = 'task_completion_v1';

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

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/smoke_devnet_verify_claim.ts',
    '',
    'Environment:',
    '  ANCHOR_PROVIDER_URL   RPC URL (default: https://api.devnet.solana.com)',
    '  ANCHOR_WALLET         authority keypair path (required)',
    '',
    'What it does:',
    '  1. creates a disposable operator',
    '  2. registers a fresh agent',
    '  3. creates + funds a task',
    '  4. submits a result',
    '  5. generates a Groth16 proof bound to the live task state',
    '  6. verifies the task on-chain',
    '  7. waits out the short devnet dispute window',
    '  8. claims payout through the MCP bridge claim_payout surface',
  ].join('\n');
}

function isBlockhashNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Blockhash not found');
}

async function sendWithRetry(
  provider: anchor.AnchorProvider,
  label: string,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const tx = new Transaction().add(...instructions);
      return await provider.sendAndConfirm(tx, signers);
    } catch (error) {
      lastError = error;
      if (!isBlockhashNotFound(error) || attempt === 4) {
        throw error;
      }
      console.warn(`${label}: blockhash expired during preflight, retrying (${attempt}/4)...`);
      await sleep(attempt * 400);
    }
  }
  throw lastError;
}

function configuredProvider(wallet: anchor.Wallet): anchor.AnchorProvider {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com';
  const connection = new anchor.web3.Connection(rpcUrl, 'confirmed');
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'processed',
    maxRetries: 5,
  });
}

function fieldElementToBytes(decimal: string): Uint8Array {
  let n = BigInt(decimal);
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

const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function canonicalFieldBytes(bytes: Uint8Array | number[]): Uint8Array {
  let acc = 0n;
  for (const byte of bytes) {
    acc = (acc << 8n) | BigInt(byte);
  }
  acc %= BN254_FIELD_MODULUS;
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

function keypairToFile(keypair: Keypair, dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
  chmodSync(path, 0o600);
  return path;
}

async function ensureAta(
  payerProvider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey,
): Promise<PublicKey> {
  const payer = payerProvider.wallet.publicKey;
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgramId);
  const info = await payerProvider.connection.getAccountInfo(ata, 'confirmed');
  if (info) return ata;
  const ix = createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint,
    tokenProgramId,
  );
  await sendWithRetry(payerProvider, `ata:${owner.toBase58().slice(0, 8)}`, [ix]);
  return ata;
}

async function mintToAta(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  destination: PublicKey,
  amount: bigint,
  tokenProgramId: PublicKey,
): Promise<string> {
  const authority = provider.wallet.publicKey;
  const ix = createMintToInstruction(
    mint,
    destination,
    authority,
    amount,
    [],
    tokenProgramId,
  );
  return sendWithRetry(provider, 'mint_to', [ix]);
}

async function runCircuitScript(scriptPath: string, extraArgs: string[] = []): Promise<void> {
  await execFileAsync('bash', [scriptPath, ...extraArgs], {
    cwd: CIRCUITS_DIR,
    env: {
      ...process.env,
      PATH: `${resolve(CIRCUITS_DIR, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
    },
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isDisputeWindowOpen(error: unknown): boolean {
  return error instanceof Error && error.message.includes('DisputeWindowOpen');
}

async function waitForDisputeWindow(
  connection: anchor.web3.Connection,
  endTs: bigint,
): Promise<void> {
  while (true) {
    const now = BigInt(await currentClusterUnixTimestamp(connection));
    if (now >= endTs) return;
    const remaining = Number(endTs - now + 1n);
    console.log(`waiting ${remaining}s for dispute window to close on cluster time...`);
    await sleep(Math.min(remaining, 5) * 1000);
  }
}

async function currentClusterUnixTimestamp(connection: anchor.web3.Connection): Promise<number> {
  const slot = await connection.getSlot('confirmed');
  const blockTime = await connection.getBlockTime(slot);
  return blockTime ?? Math.floor(Date.now() / 1000);
}

async function claimAfterDisputeWindow(
  claimTool: NonNullable<ReturnType<typeof buildTools>[number]>,
  claimCfg: ReturnType<typeof loadConfig>,
  connection: anchor.web3.Connection,
  taskAddress: string,
  disputeWindowEnd: bigint,
): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return (await claimTool.handler({ task_address: taskAddress }, claimCfg)) as Record<string, unknown>;
    } catch (error) {
      if (!isDisputeWindowOpen(error) || attempt === 6) {
        throw error;
      }
      const now = BigInt(await currentClusterUnixTimestamp(connection));
      const remaining = disputeWindowEnd > now ? Number(disputeWindowEnd - now + 2n) : 2;
      console.warn(
        `claim_payout hit DisputeWindowOpen on attempt ${attempt}; waiting ${remaining}s for cluster time to catch up...`,
      );
      await sleep(Math.min(Math.max(remaining, 2), 10) * 1000);
    }
  }

  throw new Error('claim_payout retry loop exhausted unexpectedly');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }
  if (!process.env.ANCHOR_WALLET) {
    throw new Error('ANCHOR_WALLET is required');
  }

  const authorityProvider = configuredProvider(anchor.Wallet.local());
  anchor.setProvider(authorityProvider);
  const config = resolveCluster({ cluster: 'devnet' });
  const arAuthority = agentRegistryProgram(authorityProvider, config);
  const tmAuthority = taskMarketProgram(authorityProvider, config);
  const marketGlobal = await fetchMarketGlobal(tmAuthority);
  if (!marketGlobal) throw new Error('task_market global is missing on devnet');

  const paymentMint = marketGlobal.allowedPaymentMints[0];
  if (!paymentMint) throw new Error('task_market has no allowed payment mint on devnet');
  const mintInfo = await getMint(authorityProvider.connection, paymentMint, 'confirmed', TOKEN_PROGRAM_ID);
  if (!mintInfo.mintAuthority || !mintInfo.mintAuthority.equals(authorityProvider.wallet.publicKey)) {
    throw new Error(`authority ${authorityProvider.wallet.publicKey.toBase58()} is not mint authority for ${paymentMint.toBase58()}`);
  }

  const workspace = mkdtempSync(join(tmpdir(), 'saep-proof-claim-'));
  const operator = Keypair.generate();
  const operatorPath = keypairToFile(operator, workspace, 'operator.json');
  const operatorProvider = configuredProvider(new anchor.Wallet(operator));
  const arOperator = agentRegistryProgram(operatorProvider, config);
  const tmOperator = taskMarketProgram(operatorProvider, config);

  console.log(`workspace: ${workspace}`);
  console.log(`authority: ${authorityProvider.wallet.publicKey.toBase58()}`);
  console.log(`operator: ${operator.publicKey.toBase58()}`);
  console.log(`payment_mint: ${paymentMint.toBase58()}`);

  const fundSig = await sendWithRetry(authorityProvider, 'fund_operator', [
    SystemProgram.transfer({
      fromPubkey: authorityProvider.wallet.publicKey,
      toPubkey: operator.publicKey,
      lamports: Number(DEFAULT_OPERATOR_LAMPORTS),
    }),
  ]);
  console.log(`fund_operator: ${fundSig}`);

  const clientAta = await ensureAta(
    authorityProvider,
    paymentMint,
    authorityProvider.wallet.publicKey,
    TOKEN_PROGRAM_ID,
  );
  const operatorAta = await ensureAta(
    authorityProvider,
    paymentMint,
    operator.publicKey,
    TOKEN_PROGRAM_ID,
  );
  const feeCollectorAta = await ensureAta(
    authorityProvider,
    paymentMint,
    marketGlobal.feeCollector,
    TOKEN_PROGRAM_ID,
  );
  const solrepPoolAta = await ensureAta(
    authorityProvider,
    paymentMint,
    marketGlobal.solrepPool,
    TOKEN_PROGRAM_ID,
  );

  const mintSig = await mintToAta(
    authorityProvider,
    paymentMint,
    clientAta,
    DEFAULT_PAYMENT_AMOUNT * 4n,
    TOKEN_PROGRAM_ID,
  );
  console.log(`mint_to_client: ${mintSig}`);

  const agentId = encodeAgentId(`proof-smoke-${Date.now().toString(36)}`.slice(0, 32));
  const registerIx = await buildRegisterAgentIx(arOperator, {
    operator: operator.publicKey,
    agentId,
    manifestUri: 'https://example.com/saep/devnet-proof-claim-agent.json',
    capabilityMask: 1n,
    priceLamports: 0n,
    streamRate: 0n,
    stakeAmount: 0n,
    stakeMint: paymentMint,
    operatorTokenAccount: operatorAta,
    capabilityRegistryProgramId: config.programIds.capabilityRegistry,
    tokenProgramId: TOKEN_PROGRAM_ID,
  });
  const registerSig = await sendWithRetry(operatorProvider, 'register_agent', [registerIx]);
  console.log(`register_agent: ${registerSig}`);

  const registered = (await fetchAgentsByOperator(arAuthority, operator.publicKey)).find((agent) =>
    Buffer.from(agent.agentId).equals(Buffer.from(agentId)),
  );
  if (!registered) throw new Error('registered agent could not be fetched back by operator');

  const sample = JSON.parse(readFileSync(SAMPLE_INPUT_PATH, 'utf8')) as SampleInput;
  const resultHashBytes = fieldElementToBytes(sample.result_hash);
  const criteriaRootBytes = fieldElementToBytes(sample.criteria_root);
  const proofKey = createHash('sha256')
    .update(`proof:${Date.now()}:${registered.address.toBase58()}`)
    .digest()
    .subarray(0, 32);
  const taskNonce = randomBytes(8);
  const [taskPk] = taskPda(config.programIds.taskMarket, authorityProvider.wallet.publicKey, taskNonce);
  const clusterNow = await currentClusterUnixTimestamp(authorityProvider.connection);
  const deadline = BigInt(clusterNow + DEFAULT_DEADLINE_LEAD_SECS);

  const createIx = await buildCreateTaskIx(tmAuthority, config, {
    client: authorityProvider.wallet.publicKey,
    taskNonce,
    agentDid: registered.did,
    agentOperator: operator.publicKey,
    agentId: registered.agentId,
    paymentMint,
    paymentAmount: DEFAULT_PAYMENT_AMOUNT,
    payload: {
      kind: { generic: { capabilityBit: 0, argsHash: new Uint8Array(32) } },
      capabilityBit: 0,
      criteria: new Uint8Array(),
    },
    criteriaRoot: criteriaRootBytes,
    deadline,
    milestoneCount: 1,
  });
  const createSig = await sendWithRetry(authorityProvider, 'create_task', [createIx]);
  console.log(`create_task: ${createSig}`);
  console.log(`task_address: ${taskPk.toBase58()}`);

  const fundIx = await buildFundTaskIx(tmAuthority, {
    client: authorityProvider.wallet.publicKey,
    task: taskPk,
    paymentMint,
    clientTokenAccount: clientAta,
    tokenProgramId: TOKEN_PROGRAM_ID,
  });
  const fundTaskSig = await sendWithRetry(authorityProvider, 'fund_task', [fundIx]);
  console.log(`fund_task: ${fundTaskSig}`);

  const submitIx = await buildSubmitResultIx(tmOperator, config, {
    operator: operator.publicKey,
    task: taskPk,
    agentAccount: registered.address,
    resultHash: resultHashBytes,
    proofKey,
  });
  const submitSig = await sendWithRetry(operatorProvider, 'submit_result', [submitIx]);
  console.log(`submit_result: ${submitSig}`);

  const rawTask = await tmAuthority.account.taskContract.fetch(taskPk) as {
    taskId: number[];
    taskHash: number[];
    resultHash: number[];
    criteriaRoot: number[];
    deadline: anchor.BN;
    submittedAt: anchor.BN;
    disputeWindowEnd: anchor.BN;
    status: Record<string, unknown>;
  };

  const liveInput: SampleInput = {
    ...sample,
    task_hash: bytesToDecimalString(canonicalFieldBytes(Uint8Array.from(rawTask.taskHash))),
    result_hash: bytesToDecimalString(canonicalFieldBytes(Uint8Array.from(rawTask.resultHash))),
    deadline: rawTask.deadline.toString(),
    submitted_at: rawTask.submittedAt.toString(),
    criteria_root: bytesToDecimalString(canonicalFieldBytes(Uint8Array.from(rawTask.criteriaRoot))),
  };
  const liveInputPath = join(workspace, 'live-proof-input.json');
  writeFileSync(liveInputPath, JSON.stringify(liveInput, null, 2) + '\n');
  console.log(`proof_input: ${liveInputPath}`);

  await runCircuitScript('task_completion/scripts/prove.sh', [liveInputPath]);
  await runCircuitScript('task_completion/scripts/verify.sh');
  console.log('circuit_proof: generated and verified locally');

  const proof = JSON.parse(readFileSync(PROOF_JSON_PATH, 'utf8')) as SnarkProof;
  const vkJson = JSON.parse(readFileSync(VERIFY_JSON_PATH, 'utf8')) as { nPublic: number };
  if (vkJson.nPublic !== 5) {
    throw new Error(`expected 5 public inputs, got ${vkJson.nPublic}`);
  }

  const vkId = computeVkId(VK_LABEL);
  const [verifierKey] = verifierKeyPda(config.programIds.proofVerifier, vkId);
  const verifyIx = await buildVerifyTaskIx(tmAuthority, config, {
    cranker: authorityProvider.wallet.publicKey,
    task: taskPk,
    verifierKey,
    vkId,
    proofA: g1ToBytes(proof.pi_a),
    proofB: g2ToBytes(proof.pi_b),
    proofC: g1ToBytes(proof.pi_c),
  });
  const verifySig = await sendWithRetry(authorityProvider, 'verify_task', [verifyIx]);
  console.log(`verify_task: ${verifySig}`);

  const verifiedTask = await tmAuthority.account.taskContract.fetch(taskPk) as {
    disputeWindowEnd: anchor.BN;
    status: Record<string, unknown>;
  };
  console.log(`verified_status: ${Object.keys(verifiedTask.status)[0] ?? 'unknown'}`);
  console.log(`dispute_window_end: ${verifiedTask.disputeWindowEnd.toString()}`);
  const disputeWindowEnd = BigInt(verifiedTask.disputeWindowEnd.toString());
  await waitForDisputeWindow(authorityProvider.connection, disputeWindowEnd);

  const claimTool = buildTools().find((tool) => tool.name === CLAIM_TOOL_NAME);
  if (!claimTool) throw new Error('claim_payout tool is not registered');
  const claimCfg = loadConfig({
    SAEP_CLUSTER: 'devnet',
    SAEP_RPC_URL: authorityProvider.connection.rpcEndpoint,
    SAEP_OPERATOR_KEYPAIR: operatorPath,
    SAEP_AUTO_SIGN: 'true',
    SAEP_AUTO_SIGN_MAX_LAMPORTS: '1000000000',
    SAEP_AUTO_SIGN_VELOCITY_LIMIT: '20',
  });
  const claimResult = await claimAfterDisputeWindow(
    claimTool,
    claimCfg,
    authorityProvider.connection,
    taskPk.toBase58(),
    disputeWindowEnd,
  );
  console.log('claim_payout:', JSON.stringify(claimResult, null, 2));

  const finalTask = await tmAuthority.account.taskContract.fetch(taskPk) as {
    status: Record<string, unknown>;
    paymentAmount: anchor.BN;
  };
  const operatorBalance = await authorityProvider.connection.getTokenAccountBalance(operatorAta, 'confirmed');
  const feeCollectorBalance = await authorityProvider.connection.getTokenAccountBalance(feeCollectorAta, 'confirmed');
  const solrepBalance = await authorityProvider.connection.getTokenAccountBalance(solrepPoolAta, 'confirmed');

  console.log('final_state:');
  console.log(
    JSON.stringify(
      {
        task_address: taskPk.toBase58(),
        task_id_hex: Buffer.from(rawTask.taskId).toString('hex'),
        agent_address: registered.address.toBase58(),
        agent_did_hex: Buffer.from(registered.did).toString('hex'),
        final_status: Object.keys(finalTask.status)[0] ?? 'unknown',
        operator_token_balance: operatorBalance.value.amount,
        fee_collector_token_balance: feeCollectorBalance.value.amount,
        solrep_pool_token_balance: solrepBalance.value.amount,
        operator_keypair_path: operatorPath,
        proof_input_path: liveInputPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
