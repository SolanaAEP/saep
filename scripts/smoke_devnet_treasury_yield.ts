import * as anchor from '@coral-xyz/anchor';
import type { AccountMeta, TransactionInstruction } from '@solana/web3.js';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  agentRegistryProgram,
  buildDepositToYieldStrategyIx,
  buildWithdrawFromYieldStrategyIx,
  resolveCluster,
  treasuryStandardProgram,
} from '@saep/sdk';

type RouteAction = 'deposit' | 'withdraw';

type RouteResponse = {
  routeDataHex: string;
  routeAccounts: Array<{
    pubkey: string;
    isSigner?: boolean;
    isWritable?: boolean;
  }>;
};

const SEND_ACK = 'I_UNDERSTAND_DEVNET_TREASURY_YIELD';
const DEFAULT_DISCOVERY_URL = 'https://saep-indexer-api.onrender.com';
const DEFAULT_KAMINO_LEND_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';

type StrategyInput = {
  strategyIdHex: string;
  underlyingMint: PublicKey;
  receiptMint: PublicKey;
  kaminoProgram: PublicKey;
  source: string;
};

type AgentInput = {
  agentDidHex: string;
  source: string;
};

function usage(): string {
  return [
    'Usage: pnpm smoke:devnet-treasury-yield [--send]',
    '',
    'Usually required:',
    '  SAEP_TREASURY_AGENT_DID_HEX         32-byte treasury agent DID hex',
    '  SAEP_KAMINO_ROUTE_BUILDER_URL       HTTP endpoint returning routeDataHex + routeAccounts',
    '',
    'Auto-discovered when omitted:',
    '  SAEP_DISCOVERY_URL                  Discovery URL (default: hosted Render Discovery)',
    '  SAEP_TREASURY_STRATEGY_ID_HEX       32-byte Kamino strategy id hex',
    '  SAEP_TREASURY_UNDERLYING_MINT       USDC/underlying mint public key',
    '  SAEP_TREASURY_RECEIPT_MINT          Kamino receipt mint public key',
    '  SAEP_TREASURY_KAMINO_PROGRAM        Approved Kamino program public key',
    '',
    'Optional:',
    '  ANCHOR_PROVIDER_URL                 RPC URL (default: devnet)',
    '  ANCHOR_WALLET                       Operator keypair path, required with --send',
    '  SAEP_TREASURY_DEPOSIT_AMOUNT        Base units to deposit (default: 1000000)',
    '  SAEP_TREASURY_WITHDRAW_RECEIPTS     Receipt units to withdraw (default: deposit amount)',
    '  SAEP_TREASURY_DEPOSIT_ROUTE_DATA_HEX / SAEP_TREASURY_DEPOSIT_ROUTE_ACCOUNTS_JSON',
    '  SAEP_TREASURY_WITHDRAW_ROUTE_DATA_HEX / SAEP_TREASURY_WITHDRAW_ROUTE_ACCOUNTS_JSON',
    '',
    'Safety:',
    `  --send also requires SAEP_TREASURY_YIELD_SEND_ACK=${SEND_ACK}`,
    '  Without --send this script only checks prerequisites, prepares routes, and builds txs.',
    '  The script auto-loads .env.local and .env from the repo root.',
    '  If no active strategy exists yet, run pnpm bootstrap:devnet-treasury-yield first.',
  ].join('\n');
}

function loadLocalEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eq = trimmed.indexOf('=');
      const key = trimmed.slice(0, eq).trim();
      const rawValue = trimmed.slice(eq + 1).trim();
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function optionalEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function bytesFromHex(value: string, label: string): Uint8Array {
  const clean = value.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`${label} must be 32-byte hex`);
  }
  return Uint8Array.from(clean.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
}

function loadWallet(path: string): anchor.Wallet {
  if (!existsSync(path)) throw new Error(`ANCHOR_WALLET does not exist: ${path}`);
  const secret = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(secret)));
}

function readOnlyWallet(): anchor.Wallet {
  return new anchor.Wallet(Keypair.generate());
}

function variantName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return Object.keys(value as Record<string, unknown>)[0]?.toLowerCase() ?? '';
}

function hexFromBytes(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function routeAccounts(raw: RouteResponse['routeAccounts']): AccountMeta[] {
  return raw.map((account) => ({
    pubkey: new PublicKey(account.pubkey),
    isSigner: Boolean(account.isSigner),
    isWritable: Boolean(account.isWritable),
  }));
}

function manualRoute(action: RouteAction): RouteResponse | null {
  const prefix = action === 'deposit' ? 'SAEP_TREASURY_DEPOSIT' : 'SAEP_TREASURY_WITHDRAW';
  const routeDataHex = optionalEnv(`${prefix}_ROUTE_DATA_HEX`);
  const accountsJson = optionalEnv(`${prefix}_ROUTE_ACCOUNTS_JSON`);
  if (!routeDataHex && !accountsJson) return null;
  if (!routeDataHex || !accountsJson) {
    throw new Error(`${prefix}_ROUTE_DATA_HEX and ${prefix}_ROUTE_ACCOUNTS_JSON must be set together`);
  }
  const parsed = JSON.parse(accountsJson) as RouteResponse['routeAccounts'];
  if (!Array.isArray(parsed)) throw new Error(`${prefix}_ROUTE_ACCOUNTS_JSON must be a JSON array`);
  return {
    routeDataHex: routeDataHex.replace(/^0x/, ''),
    routeAccounts: parsed,
  };
}

async function fetchRoute(
  action: RouteAction,
  amountRaw: string,
  input: {
    agentDidHex: string;
    strategyIdHex: string;
    underlyingMint: string;
    receiptMint: string;
    strategyProgram: string;
  },
): Promise<RouteResponse> {
  const manual = manualRoute(action);
  if (manual) return manual;
  const url = optionalEnv('SAEP_KAMINO_ROUTE_BUILDER_URL');
  if (!url) {
    throw new Error(
      `missing Kamino route input for ${action}. Set SAEP_KAMINO_ROUTE_BUILDER_URL, or provide manual ${action} route env (` +
        `SAEP_TREASURY_${action === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'}_ROUTE_DATA_HEX + ` +
        `SAEP_TREASURY_${action === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'}_ROUTE_ACCOUNTS_JSON). ` +
        'This is a venue-route prerequisite, not a local env bootstrap failure.',
    );
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ action, amountRaw, ...input }),
  });
  const json = (await res.json().catch(() => null)) as Partial<RouteResponse> | null;
  if (!res.ok || !json?.routeDataHex || !Array.isArray(json.routeAccounts)) {
    throw new Error(`route builder failed for ${action}: ${res.status} ${JSON.stringify(json)}`);
  }
  return {
    routeDataHex: json.routeDataHex.replace(/^0x/, ''),
    routeAccounts: json.routeAccounts,
  };
}

function routeDataFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('routeDataHex must be even-length hex');
  }
  return Uint8Array.from(hex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
}

async function maybeDiscoverySnapshot(agentDidHex: string, label: string) {
  const discovery = discoveryUrl();
  const base = discovery.replace(/\/$/, '');
  const res = await fetch(`${base}/v1/discovery/treasury/${agentDidHex}/yield/positions`);
  if (res.status === 404) {
    console.log(`${label}: discovery positions not found yet`);
    return;
  }
  if (!res.ok) {
    console.log(`${label}: discovery positions read failed (${res.status})`);
    return;
  }
  const json = await res.json();
  console.log(`${label}: discovery positions ${JSON.stringify(json)}`);
}

function discoveryUrl(): string {
  return optionalEnv('SAEP_DISCOVERY_URL') ?? optionalEnv('NEXT_PUBLIC_INDEXER_URL') ?? DEFAULT_DISCOVERY_URL;
}

async function discoverStrategyFromDiscovery(): Promise<StrategyInput | null> {
  const base = discoveryUrl().replace(/\/$/, '');
  const url = `${base}/v1/discovery/treasury/yield-strategies?venue=kamino&status=active&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    items?: Array<{
      strategy_id_hex: string;
      underlying_mint: string;
      receipt_mint: string;
      strategy_program: string;
    }>;
  };
  const row = json.items?.[0];
  if (!row) return null;
  return {
    strategyIdHex: row.strategy_id_hex,
    underlyingMint: new PublicKey(row.underlying_mint),
    receiptMint: new PublicKey(row.receipt_mint),
    kaminoProgram: new PublicKey(row.strategy_program),
    source: `Discovery ${url}`,
  };
}

async function discoverStrategyFromChain(
  program: ReturnType<typeof treasuryStandardProgram>,
): Promise<StrategyInput | null> {
  const rows = await program.account.yieldStrategyDescriptor.all();
  const row = rows.find((candidate) => {
    const account = candidate.account as {
      venue: unknown;
      status: unknown;
    };
    return variantName(account.venue) === 'kamino' && variantName(account.status) === 'active';
  });
  if (!row) return null;
  const account = row.account as {
    strategyId: number[];
    underlyingMint: PublicKey;
    receiptMint: PublicKey;
    strategyProgram: PublicKey;
  };
  return {
    strategyIdHex: hexFromBytes(account.strategyId),
    underlyingMint: account.underlyingMint,
    receiptMint: account.receiptMint,
    kaminoProgram: account.strategyProgram,
    source: `on-chain account ${row.publicKey.toBase58()}`,
  };
}

async function resolveAgentDid(
  provider: anchor.AnchorProvider,
  config: Parameters<typeof agentRegistryProgram>[1],
  shouldSend: boolean,
): Promise<AgentInput> {
  const explicit = optionalEnv('SAEP_TREASURY_AGENT_DID_HEX')?.replace(/^0x/, '').toLowerCase();
  if (explicit) {
    bytesFromHex(explicit, 'SAEP_TREASURY_AGENT_DID_HEX');
    return { agentDidHex: explicit, source: 'environment' };
  }

  const program = agentRegistryProgram(provider, config);
  const rows = await program.account.agentAccount.all();
  const activeRows = rows.filter((row) => variantName((row.account as { status: unknown }).status) === 'active');
  const operatorRows = activeRows.filter((row) =>
    (row.account as { operator: PublicKey }).operator.equals(provider.wallet.publicKey),
  );
  if (operatorRows.length === 1) {
    return {
      agentDidHex: hexFromBytes((operatorRows[0].account as { did: number[] }).did),
      source: `agent_registry operator ${provider.wallet.publicKey.toBase58()}`,
    };
  }
  if (shouldSend) {
    throw new Error(
      operatorRows.length > 1
        ? 'multiple active agents found for ANCHOR_WALLET; set SAEP_TREASURY_AGENT_DID_HEX explicitly'
        : 'no active agent found for ANCHOR_WALLET; set SAEP_TREASURY_AGENT_DID_HEX explicitly',
    );
  }
  const first = activeRows[0];
  if (first) {
    return {
      agentDidHex: hexFromBytes((first.account as { did: number[] }).did),
      source: `first active agent_registry account ${first.publicKey.toBase58()} (dry-run only)`,
    };
  }
  throw new Error('missing SAEP_TREASURY_AGENT_DID_HEX and no active devnet AgentAccount was discoverable');
}

async function resolveStrategy(
  program: ReturnType<typeof treasuryStandardProgram>,
): Promise<StrategyInput> {
  const strategyIdHex = optionalEnv('SAEP_TREASURY_STRATEGY_ID_HEX')?.replace(/^0x/, '').toLowerCase();
  const underlying = optionalEnv('SAEP_TREASURY_UNDERLYING_MINT');
  const receipt = optionalEnv('SAEP_TREASURY_RECEIPT_MINT');
  const kamino = optionalEnv('SAEP_TREASURY_KAMINO_PROGRAM') ?? DEFAULT_KAMINO_LEND_PROGRAM;
  if (strategyIdHex && underlying && receipt && kamino) {
    return {
      strategyIdHex,
      underlyingMint: new PublicKey(underlying),
      receiptMint: new PublicKey(receipt),
      kaminoProgram: new PublicKey(kamino),
      source: 'environment',
    };
  }

  const discoveryStrategy = await discoverStrategyFromDiscovery();
  if (discoveryStrategy) return discoveryStrategy;

  const chainStrategy = await discoverStrategyFromChain(program);
  if (chainStrategy) return chainStrategy;

  throw new Error(
    'no active Kamino strategy was found in Discovery or on-chain devnet state. ' +
      'Bootstrap/register one with `pnpm bootstrap:devnet-treasury-yield`, or set ' +
      'SAEP_TREASURY_STRATEGY_ID_HEX, SAEP_TREASURY_UNDERLYING_MINT, SAEP_TREASURY_RECEIPT_MINT, ' +
      'and optionally SAEP_TREASURY_KAMINO_PROGRAM. This is missing devnet setup, not a generic local env failure.',
  );
}

async function sendOrDescribe(
  provider: anchor.AnchorProvider,
  label: string,
  ix: TransactionInstruction,
  shouldSend: boolean,
) {
  const tx = new Transaction().add(ix);
  tx.feePayer = provider.wallet.publicKey;
  const { blockhash } = await provider.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  console.log(`${label}: built tx with ${ix.keys.length} account metas`);
  if (!shouldSend) return null;

  const simulation = await provider.connection.simulateTransaction(tx, [(provider.wallet as anchor.Wallet).payer]);
  if (simulation.value.err) {
    throw new Error(`${label}: simulation failed ${JSON.stringify(simulation.value.err)}`);
  }
  console.log(`${label}: simulation ok, sending on devnet...`);
  return provider.sendAndConfirm(tx, [], { commitment: 'confirmed' });
}

async function main() {
  loadLocalEnvFiles();
  const shouldSend = process.argv.includes('--send');
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }
  if (shouldSend && process.env.SAEP_TREASURY_YIELD_SEND_ACK !== SEND_ACK) {
    throw new Error(`--send requires SAEP_TREASURY_YIELD_SEND_ACK=${SEND_ACK}`);
  }

  const depositAmount = process.env.SAEP_TREASURY_DEPOSIT_AMOUNT?.trim() || '1000000';
  const withdrawReceipts = process.env.SAEP_TREASURY_WITHDRAW_RECEIPTS?.trim() || depositAmount;

  if (!/^[1-9][0-9]*$/.test(depositAmount) || !/^[1-9][0-9]*$/.test(withdrawReceipts)) {
    throw new Error('deposit and withdraw amounts must be positive integer base units');
  }

  const walletPath = optionalEnv('ANCHOR_WALLET');
  const wallet = shouldSend ? loadWallet(requiredEnv('ANCHOR_WALLET')) : walletPath ? loadWallet(walletPath) : readOnlyWallet();
  const config = resolveCluster({
    cluster: 'devnet',
    endpoint: process.env.ANCHOR_PROVIDER_URL,
  });
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(config.endpoint, 'confirmed'),
    wallet,
    { commitment: 'confirmed', preflightCommitment: 'processed', maxRetries: 5 },
  );
  const program = treasuryStandardProgram(provider, config);
  const agent = await resolveAgentDid(provider, config, shouldSend);
  const strategy = await resolveStrategy(program);
  const common = {
    agentDid: bytesFromHex(agent.agentDidHex, 'SAEP_TREASURY_AGENT_DID_HEX'),
    strategyId: bytesFromHex(strategy.strategyIdHex, 'SAEP_TREASURY_STRATEGY_ID_HEX'),
    mint: strategy.underlyingMint,
    receiptMint: strategy.receiptMint,
    kaminoProgram: strategy.kaminoProgram,
  };
  const routeInput = {
    agentDidHex: agent.agentDidHex,
    strategyIdHex: strategy.strategyIdHex,
    underlyingMint: strategy.underlyingMint.toBase58(),
    receiptMint: strategy.receiptMint.toBase58(),
    strategyProgram: strategy.kaminoProgram.toBase58(),
  };

  console.log(`cluster: devnet`);
  console.log(`rpc:     ${config.endpoint}`);
  console.log(`wallet:  ${provider.wallet.publicKey.toBase58()}${shouldSend ? '' : ' (read-only dry run)'}`);
  console.log(`agent:   ${agent.agentDidHex} (${agent.source})`);
  console.log(`strategy:${strategy.strategyIdHex} (${strategy.source})`);
  console.log(`discover:${discoveryUrl()}`);

  await maybeDiscoverySnapshot(agent.agentDidHex, 'before');
  const depositRoute = await fetchRoute('deposit', depositAmount, routeInput);
  const withdrawRoute = await fetchRoute('withdraw', withdrawReceipts, routeInput);

  const depositIx = await buildDepositToYieldStrategyIx(program, {
    ...common,
    operator: provider.wallet.publicKey,
    amount: BigInt(depositAmount),
    routeData: routeDataFromHex(depositRoute.routeDataHex),
    routeAccounts: routeAccounts(depositRoute.routeAccounts),
  });
  const withdrawIx = await buildWithdrawFromYieldStrategyIx(program, {
    ...common,
    operator: provider.wallet.publicKey,
    receiptAmount: BigInt(withdrawReceipts),
    routeData: routeDataFromHex(withdrawRoute.routeDataHex),
    routeAccounts: routeAccounts(withdrawRoute.routeAccounts),
  });

  const depositSig = await sendOrDescribe(provider, 'deposit', depositIx, shouldSend);
  if (depositSig) console.log(`deposit signature: ${depositSig}`);
  const withdrawSig = await sendOrDescribe(provider, 'withdraw', withdrawIx, shouldSend);
  if (withdrawSig) console.log(`withdraw signature: ${withdrawSig}`);
  await maybeDiscoverySnapshot(agent.agentDidHex, 'after');

  if (!shouldSend) {
    console.log('\ndry run complete. Re-run with --send and explicit ACK to submit devnet transactions.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.error('\n' + usage());
  process.exit(1);
});
