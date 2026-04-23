import * as anchor from '@coral-xyz/anchor';
import { getPublicKeyAsync, hashes, signAsync } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import RedisMock from 'ioredis-mock';
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  ParsedTransactionWithMeta,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  agentRegistryProgram,
  buildRegisterAgentIx,
  encodeAgentId,
  fetchAgentsByOperator,
  fetchMarketGlobal,
  resolveCluster,
  taskMarketProgram,
} from '@saep/sdk';
import { canonicalizeProxy } from '../services/x402-gateway/src/auth.js';
import { loadConfig } from '../services/x402-gateway/src/config.js';
import { build } from '../services/x402-gateway/src/server.js';

hashes.sha512 = sha512;

const execFileAsync = promisify(execFile);
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_PAYMENT_AMOUNT = 1_000_000n;
const DEFAULT_DISPUTE_WINDOW_SECS = 10n;
const DEFAULT_TASK_DEADLINE_SECS = 65;
const DEFAULT_OPERATOR_LAMPORTS = 100_000_000n;
const DEFAULT_MANAGED_LABEL = 'managed';
const DEFAULT_UNMANAGED_LABEL = 'unmanaged';
const DEFAULT_WALLET_PATH = resolve(process.env.HOME ?? '~', '.config/solana/id.json');

type Mode = 'managed' | 'unmanaged' | 'both';

type CliOptions = {
  mode: Mode;
  paymentAmount: bigint;
  disputeWindowSecs: bigint;
  skipBootstrap: boolean;
  keepDisputeWindow: boolean;
  help: boolean;
};

type RegisteredRecipient = {
  operator: Keypair;
  operatorPath: string;
  address: PublicKey;
  didBytes: Uint8Array;
  didBase58: string;
};

type LifecycleSummary = {
  settleTxSig: string;
  submitTxSig?: string;
  verifyTxSig?: string;
  releaseTxSig?: string;
  taskAddress: string;
  taskIdHex?: string;
  receiptStatus?: string;
  verifyStatus?: string;
  finalStatus?: string;
};

type ScenarioResult = {
  mode: 'managed' | 'unmanaged';
  receipt: Record<string, unknown>;
  facilitateVerify: Record<string, unknown>;
  lifecycle: LifecycleSummary;
};

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/smoke_devnet_x402.ts [options]',
    '',
    'Options:',
    '  --mode <managed|unmanaged|both>   Which x402 flow(s) to run (default: both)',
    `  --payment-amount <amount>         Payment amount in mint base units (default: ${DEFAULT_PAYMENT_AMOUNT.toString()})`,
    `  --dispute-window-secs <secs>      Temporary dispute window during managed smoke (default: ${DEFAULT_DISPUTE_WINDOW_SECS.toString()})`,
    '  --skip-bootstrap                  Skip proof-verifier bootstrap validation',
    '  --keep-dispute-window             Leave the temporary dispute window in place',
    '  --help                            Show this help text',
    '',
    'Environment:',
    `  ANCHOR_WALLET         Authority wallet path (default: ${DEFAULT_WALLET_PATH})`,
    `  ANCHOR_PROVIDER_URL   Devnet RPC URL (default: ${DEFAULT_RPC_URL})`,
    '',
    'What it does:',
    '  1. validates or bootstraps proof-verifier readiness on devnet',
    '  2. registers a managed recipient agent',
    '  3. starts the real x402 gateway locally with a mock Redis backend',
    '  4. drives /proxy against /demo/paid for managed and/or unmanaged mode',
    '  5. verifies refreshed task status through /facilitate/verify',
    '  6. prints settle, submit, verify, and release signatures when present',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'both',
    paymentAmount: DEFAULT_PAYMENT_AMOUNT,
    disputeWindowSecs: DEFAULT_DISPUTE_WINDOW_SECS,
    skipBootstrap: false,
    keepDisputeWindow: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--mode':
        options.mode = (argv[++i] as Mode | undefined) ?? 'both';
        break;
      case '--payment-amount':
        options.paymentAmount = BigInt(argv[++i] ?? '0');
        break;
      case '--dispute-window-secs':
        options.disputeWindowSecs = BigInt(argv[++i] ?? '0');
        break;
      case '--skip-bootstrap':
        options.skipBootstrap = true;
        break;
      case '--keep-dispute-window':
        options.keepDisputeWindow = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (options.help) return options;
  if (!['managed', 'unmanaged', 'both'].includes(options.mode)) {
    throw new Error(`--mode must be managed, unmanaged, or both\n\n${usage()}`);
  }
  if (options.paymentAmount <= 0n) {
    throw new Error(`--payment-amount must be > 0\n\n${usage()}`);
  }
  if (options.disputeWindowSecs <= 0n) {
    throw new Error(`--dispute-window-secs must be > 0\n\n${usage()}`);
  }
  return options;
}

function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
}

function keypairToFile(keypair: Keypair, dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
  chmodSync(path, 0o600);
  return path;
}

function configuredProvider(wallet: anchor.Wallet, rpcUrl: string): anchor.AnchorProvider {
  const connection = new anchor.web3.Connection(rpcUrl, 'confirmed');
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'processed',
    maxRetries: 5,
  });
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function resolveTokenProgram(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info) throw new Error(`payment mint ${mint.toBase58()} was not found`);
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(`payment mint ${mint.toBase58()} is not an SPL token mint`);
}

async function ensureAta(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey,
): Promise<PublicKey> {
  const payer = provider.wallet.publicKey;
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgramId);
  const info = await provider.connection.getAccountInfo(ata, 'confirmed');
  if (info) return ata;
  const ix = createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint,
    tokenProgramId,
  );
  await sendWithRetry(provider, `ata:${owner.toBase58().slice(0, 8)}`, [ix]);
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

async function ensureAuthorityPaymentBalance(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  amountNeeded: bigint,
  tokenProgramId: PublicKey,
): Promise<PublicKey> {
  const mintInfo = await getMint(provider.connection, mint, 'confirmed', tokenProgramId);
  if (!mintInfo.mintAuthority || !mintInfo.mintAuthority.equals(provider.wallet.publicKey)) {
    throw new Error(
      `authority ${provider.wallet.publicKey.toBase58()} is not mint authority for ${mint.toBase58()}`,
    );
  }

  const ata = await ensureAta(provider, mint, provider.wallet.publicKey, tokenProgramId);
  const balance = await provider.connection.getTokenAccountBalance(ata, 'confirmed');
  const current = BigInt(balance.value.amount);
  if (current >= amountNeeded) return ata;

  const topUp = amountNeeded - current;
  const mintSig = await mintToAta(provider, mint, ata, topUp, tokenProgramId);
  console.log(`mint_to_gateway: ${mintSig}`);
  return ata;
}

async function currentClusterUnixTimestamp(connection: anchor.web3.Connection): Promise<number> {
  const slot = await connection.getSlot('confirmed');
  const blockTime = await connection.getBlockTime(slot);
  return blockTime ?? Math.floor(Date.now() / 1000);
}

async function runChild(label: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  console.log(`${label}: ${args.join(' ')}`);
  const { stdout, stderr } = await execFileAsync(args[0]!, args.slice(1), {
    cwd: resolve(__dirname, '..'),
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

async function maybeBootstrapVerifier(authorityPath: string, rpcUrl: string): Promise<void> {
  await runChild(
    'bootstrap_proof_verifier_devnet',
    ['pnpm', 'exec', 'tsx', 'scripts/bootstrap_proof_verifier_devnet.ts'],
    {
      ...process.env,
      ANCHOR_WALLET: authorityPath,
      ANCHOR_PROVIDER_URL: rpcUrl,
    },
  );
}

async function setDisputeWindow(authorityPath: string, rpcUrl: string, secs: bigint): Promise<void> {
  await runChild(
    'set_task_market_dispute_window',
    ['pnpm', 'exec', 'tsx', 'scripts/set_task_market_dispute_window.ts', '--secs', secs.toString()],
    {
      ...process.env,
      ANCHOR_WALLET: authorityPath,
      ANCHOR_PROVIDER_URL: rpcUrl,
    },
  );
}

function parseTaskStatus(status: Record<string, unknown>): string {
  return Object.keys(status)[0] ?? 'unknown';
}

async function registerManagedRecipient(
  authorityProvider: anchor.AnchorProvider,
  rpcUrl: string,
  workspace: string,
  paymentMint: PublicKey,
  tokenProgramId: PublicKey,
): Promise<RegisteredRecipient> {
  const config = resolveCluster({ cluster: 'devnet', endpoint: rpcUrl });
  const arAuthority = agentRegistryProgram(authorityProvider, config);
  const operator = Keypair.generate();
  const operatorPath = keypairToFile(operator, workspace, 'x402-recipient-operator.json');
  const operatorProvider = configuredProvider(new anchor.Wallet(operator), rpcUrl);
  const arOperator = agentRegistryProgram(operatorProvider, config);

  const fundSig = await sendWithRetry(authorityProvider, 'fund_recipient_operator', [
    SystemProgram.transfer({
      fromPubkey: authorityProvider.wallet.publicKey,
      toPubkey: operator.publicKey,
      lamports: Number(DEFAULT_OPERATOR_LAMPORTS),
    }),
  ]);
  console.log(`fund_recipient_operator: ${fundSig}`);

  const operatorAta = await ensureAta(authorityProvider, paymentMint, operator.publicKey, tokenProgramId);
  const agentId = encodeAgentId(`x402-smoke-${Date.now().toString(36)}`.slice(0, 32));
  const registerIx = await buildRegisterAgentIx(arOperator, {
    operator: operator.publicKey,
    agentId,
    manifestUri: 'https://example.com/saep/devnet-x402-managed-agent.json',
    capabilityMask: 1n,
    priceLamports: 0n,
    streamRate: 0n,
    stakeAmount: 0n,
    stakeMint: paymentMint,
    operatorTokenAccount: operatorAta,
    capabilityRegistryProgramId: config.programIds.capabilityRegistry,
    tokenProgramId,
  });
  const registerSig = await sendWithRetry(operatorProvider, 'register_managed_recipient', [registerIx]);
  console.log(`register_managed_recipient: ${registerSig}`);

  const registered = (await fetchAgentsByOperator(arAuthority, operator.publicKey)).find((agent) =>
    Buffer.from(agent.agentId).equals(Buffer.from(agentId)),
  );
  if (!registered) throw new Error('managed recipient agent could not be fetched back by operator');

  const didBytes = Uint8Array.from(registered.did);
  return {
    operator,
    operatorPath,
    address: registered.address,
    didBytes,
    didBase58: bs58.encode(didBytes),
  };
}

async function signProxyBody(
  body: {
    target_url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    budget_lamports: number;
    mint: string;
    nonce: string;
    body_hash?: string;
  },
): Promise<{ agent_did: string; signature: string }> {
  const secret = randomBytes(32);
  const publicKey = await getPublicKeyAsync(secret);
  const canonical = canonicalizeProxy(body);
  const signature = await signAsync(new TextEncoder().encode(canonical), secret);
  return {
    agent_did: bs58.encode(publicKey),
    signature: bs58.encode(signature),
  };
}

async function fetchLifecycleSummary(
  connection: Connection,
  taskAddress: PublicKey,
  settleTxSig: string,
): Promise<Pick<LifecycleSummary, 'submitTxSig' | 'verifyTxSig' | 'releaseTxSig'>> {
  const signatures = await connection.getSignaturesForAddress(taskAddress, { limit: 20 }, 'confirmed');
  const out: Pick<LifecycleSummary, 'submitTxSig' | 'verifyTxSig' | 'releaseTxSig'> = {};

  for (const sig of signatures) {
    if (sig.signature === settleTxSig) continue;
    const tx = await connection.getTransaction(sig.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    }) as ParsedTransactionWithMeta | null;
    const logs = tx?.meta?.logMessages ?? [];
    if (!out.releaseTxSig && logs.some((line) => line.includes('Instruction: Release'))) {
      out.releaseTxSig = sig.signature;
    } else if (!out.verifyTxSig && logs.some((line) => line.includes('Instruction: VerifyTask'))) {
      out.verifyTxSig = sig.signature;
    } else if (!out.submitTxSig && logs.some((line) => line.includes('Instruction: SubmitResult'))) {
      out.submitTxSig = sig.signature;
    }
  }

  return out;
}

async function runScenario(opts: {
  label: string;
  authorityPath: string;
  rpcUrl: string;
  recipient: RegisteredRecipient;
  paymentMint: PublicKey;
  paymentAmount: bigint;
  managed: boolean;
}): Promise<ScenarioResult> {
  const redis = new RedisMock();
  const cfg = loadConfig({
    HOST: '127.0.0.1',
    PORT: '8787',
    REDIS_URL: 'redis://127.0.0.1:6379',
    ALLOW_LIST: '127.0.0.1',
    PROXY_TIMEOUT_MS: '45000',
    MAX_402_RETRIES: '1',
    SAEP_CLUSTER: 'devnet',
    SOLANA_RPC_URL: opts.rpcUrl,
    SAEP_OPERATOR_KEYPAIR: opts.authorityPath,
    X402_TASK_DEADLINE_SECS: String(DEFAULT_TASK_DEADLINE_SECS),
    ...(opts.managed ? { X402_RECIPIENT_OPERATOR_KEYPAIR: opts.recipient.operatorPath } : {}),
    X402_DEMO_PAYMENT_MINT: opts.paymentMint.toBase58(),
    X402_DEMO_PAYMENT_AMOUNT: opts.paymentAmount.toString(),
    X402_DEMO_RECIPIENT_DID: opts.recipient.didBase58,
  });
  const app = build({ cfg, redis: redis as never });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('x402 smoke could not determine app port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`${opts.label}: gateway ${baseUrl}`);

  try {
    const proxyBody = {
      target_url: `${baseUrl}/demo/paid`,
      method: 'GET' as const,
      budget_lamports: Number(opts.paymentAmount * 2n),
      mint: opts.paymentMint.toBase58(),
      nonce: `${opts.label}-${Date.now().toString(36)}`,
    };
    const signed = await signProxyBody(proxyBody);

    const res = await fetch(`${baseUrl}/proxy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...proxyBody,
        ...signed,
      }),
    });
    const payload = await res.json() as {
      status?: number;
      body?: string;
      payment_receipts?: Array<Record<string, unknown>>;
      error?: string;
      detail?: string;
    };
    if (!res.ok) {
      throw new Error(`${opts.label}: /proxy failed ${res.status} ${JSON.stringify(payload)}`);
    }
    const receipt = payload.payment_receipts?.[0];
    if (!receipt) {
      throw new Error(`${opts.label}: /proxy returned no payment receipt`);
    }

    const verifyRes = await fetch(`${baseUrl}/facilitate/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        x_payment: JSON.stringify(receipt),
        resource_ref: '/demo/paid',
      }),
    });
    const verifyPayload = await verifyRes.json() as Record<string, unknown>;
    if (!verifyRes.ok) {
      throw new Error(`${opts.label}: /facilitate/verify failed ${verifyRes.status} ${JSON.stringify(verifyPayload)}`);
    }

    const taskAddress = String(receipt.task);
    const settleTxSig = String(receipt.tx_sig);
    const connection = new Connection(opts.rpcUrl, 'confirmed');
    const config = resolveCluster({ cluster: 'devnet', endpoint: opts.rpcUrl });
    const authorityProvider = configuredProvider(new anchor.Wallet(loadKeypair(opts.authorityPath)), opts.rpcUrl);
    const taskMarket = taskMarketProgram(authorityProvider, config);
    const task = await taskMarket.account.taskContract.fetch(new PublicKey(taskAddress)) as {
      taskId: number[];
      status: Record<string, unknown>;
    };
    const lifecycle = await fetchLifecycleSummary(connection, new PublicKey(taskAddress), settleTxSig);
    const finalStatus = parseTaskStatus(task.status);
    const receiptStatus = typeof receipt.task_status === 'string' ? receipt.task_status : undefined;
    const verifyStatus = typeof verifyPayload.task_status === 'string' ? verifyPayload.task_status : undefined;

    if (opts.managed) {
      if (finalStatus !== 'released' || receiptStatus !== 'released' || verifyStatus !== 'released') {
        throw new Error(
          `${opts.label}: expected managed flow to reach released; got final=${finalStatus} receipt=${receiptStatus} verify=${verifyStatus}`,
        );
      }
      if (!lifecycle.verifyTxSig || !lifecycle.releaseTxSig) {
        throw new Error(`${opts.label}: expected verify/release transactions in managed flow`);
      }
    } else {
      if (finalStatus === 'released' || receiptStatus === 'released' || verifyStatus === 'released') {
        throw new Error(`${opts.label}: unmanaged flow should not auto-release`);
      }
      if (lifecycle.verifyTxSig || lifecycle.releaseTxSig) {
        throw new Error(`${opts.label}: unmanaged flow unexpectedly performed verify/release`);
      }
    }

    console.log(`${opts.label}: task=${taskAddress}`);
    console.log(`${opts.label}: settle_tx=${settleTxSig}`);
    if (lifecycle.submitTxSig) console.log(`${opts.label}: submit_tx=${lifecycle.submitTxSig}`);
    if (lifecycle.verifyTxSig) console.log(`${opts.label}: verify_tx=${lifecycle.verifyTxSig}`);
    if (lifecycle.releaseTxSig) console.log(`${opts.label}: release_tx=${lifecycle.releaseTxSig}`);
    console.log(`${opts.label}: final_status=${finalStatus}`);

    return {
      mode: opts.managed ? 'managed' : 'unmanaged',
      receipt,
      facilitateVerify: verifyPayload,
      lifecycle: {
        settleTxSig,
        submitTxSig: lifecycle.submitTxSig,
        verifyTxSig: lifecycle.verifyTxSig,
        releaseTxSig: lifecycle.releaseTxSig,
        taskAddress,
        taskIdHex: Buffer.from(task.taskId).toString('hex'),
        receiptStatus,
        verifyStatus,
        finalStatus,
      },
    };
  } finally {
    await app.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const authorityPath = process.env.ANCHOR_WALLET ?? DEFAULT_WALLET_PATH;
  if (!existsSync(authorityPath)) {
    throw new Error(`ANCHOR_WALLET not found at ${authorityPath}`);
  }
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const workspace = mkdtempSync(join(tmpdir(), 'saep-x402-smoke-'));
  const authorityKeypair = loadKeypair(authorityPath);
  const authorityProvider = configuredProvider(new anchor.Wallet(authorityKeypair), rpcUrl);
  const config = resolveCluster({ cluster: 'devnet', endpoint: rpcUrl });
  const taskMarket = taskMarketProgram(authorityProvider, config);
  const marketGlobal = await fetchMarketGlobal(taskMarket);

  if (!marketGlobal) throw new Error('task_market global is missing on devnet');
  const paymentMint = marketGlobal.allowedPaymentMints[0];
  if (!paymentMint) throw new Error('task_market has no allowed payment mint on devnet');
  const tokenProgramId = await resolveTokenProgram(authorityProvider.connection, paymentMint);

  console.log(`workspace: ${workspace}`);
  console.log(`authority: ${authorityProvider.wallet.publicKey.toBase58()}`);
  console.log(`rpc_url: ${rpcUrl}`);
  console.log(`payment_mint: ${paymentMint.toBase58()}`);

  let originalDisputeWindow = marketGlobal.disputeWindowSecs;
  let disputeWindowChanged = false;

  try {
    if (!options.skipBootstrap && options.mode !== 'unmanaged') {
      await maybeBootstrapVerifier(authorityPath, rpcUrl);
    }

    if (options.mode !== 'unmanaged' && originalDisputeWindow !== options.disputeWindowSecs) {
      await setDisputeWindow(authorityPath, rpcUrl, options.disputeWindowSecs);
      disputeWindowChanged = true;
    }

    await ensureAuthorityPaymentBalance(
      authorityProvider,
      paymentMint,
      options.paymentAmount * 6n,
      tokenProgramId,
    );
    await ensureAta(authorityProvider, paymentMint, marketGlobal.feeCollector, tokenProgramId);
    await ensureAta(authorityProvider, paymentMint, marketGlobal.solrepPool, tokenProgramId);

    const recipient = await registerManagedRecipient(
      authorityProvider,
      rpcUrl,
      workspace,
      paymentMint,
      tokenProgramId,
    );
    console.log(`managed_recipient_agent: ${recipient.address.toBase58()}`);
    console.log(`managed_recipient_did: ${recipient.didBase58}`);

    const results: ScenarioResult[] = [];
    if (options.mode === 'managed' || options.mode === 'both') {
      results.push(await runScenario({
        label: DEFAULT_MANAGED_LABEL,
        authorityPath,
        rpcUrl,
        recipient,
        paymentMint,
        paymentAmount: options.paymentAmount,
        managed: true,
      }));
    }

    if (options.mode === 'unmanaged' || options.mode === 'both') {
      results.push(await runScenario({
        label: DEFAULT_UNMANAGED_LABEL,
        authorityPath,
        rpcUrl,
        recipient,
        paymentMint,
        paymentAmount: options.paymentAmount,
        managed: false,
      }));
    }

    console.log('x402_smoke_summary:');
    console.log(JSON.stringify({
      rpc_url: rpcUrl,
      authority: authorityProvider.wallet.publicKey.toBase58(),
      payment_mint: paymentMint.toBase58(),
      recipient_agent: recipient.address.toBase58(),
      recipient_did: recipient.didBase58,
      managed_mode_switch: 'X402_RECIPIENT_OPERATOR_KEYPAIR',
      results,
    }, null, 2));
  } finally {
    try {
      if (disputeWindowChanged && !options.keepDisputeWindow) {
        const refreshed = await fetchMarketGlobal(taskMarket);
        originalDisputeWindow = refreshed?.disputeWindowSecs ?? originalDisputeWindow;
        await setDisputeWindow(authorityPath, rpcUrl, marketGlobal.disputeWindowSecs);
      }
    } catch (error) {
      console.warn(`warning: failed to restore dispute window: ${error instanceof Error ? error.message : String(error)}`);
    }
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
