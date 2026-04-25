import * as anchor from '@coral-xyz/anchor';
import type { AccountMeta, TransactionInstruction } from '@solana/web3.js';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { existsSync, readFileSync } from 'node:fs';
import {
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

function usage(): string {
  return [
    'Usage: pnpm smoke:devnet-treasury-yield [--send]',
    '',
    'Required environment:',
    '  SAEP_KAMINO_ROUTE_BUILDER_URL       HTTP endpoint returning routeDataHex + routeAccounts',
    '  SAEP_TREASURY_AGENT_DID_HEX         32-byte treasury agent DID hex',
    '  SAEP_TREASURY_STRATEGY_ID_HEX       32-byte Kamino strategy id hex',
    '  SAEP_TREASURY_UNDERLYING_MINT       USDC/underlying mint public key',
    '  SAEP_TREASURY_RECEIPT_MINT          Kamino receipt mint public key',
    '  SAEP_TREASURY_KAMINO_PROGRAM        Approved Kamino program public key',
    '',
    'Optional environment:',
    '  ANCHOR_PROVIDER_URL                 RPC URL (default: devnet)',
    '  ANCHOR_WALLET                       Operator keypair path, required with --send',
    '  SAEP_TREASURY_DEPOSIT_AMOUNT        Base units to deposit (default: 1000000)',
    '  SAEP_TREASURY_WITHDRAW_RECEIPTS     Receipt units to withdraw (default: deposit amount)',
    '  SAEP_DISCOVERY_URL                  Discovery URL used for before/after snapshot reads',
    '',
    'Safety:',
    `  --send also requires SAEP_TREASURY_YIELD_SEND_ACK=${SEND_ACK}`,
    '  Without --send this script only checks prerequisites, prepares routes, and builds txs.',
  ].join('\n');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
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

function routeAccounts(raw: RouteResponse['routeAccounts']): AccountMeta[] {
  return raw.map((account) => ({
    pubkey: new PublicKey(account.pubkey),
    isSigner: Boolean(account.isSigner),
    isWritable: Boolean(account.isWritable),
  }));
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
  const url = requiredEnv('SAEP_KAMINO_ROUTE_BUILDER_URL');
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
  const discovery = process.env.SAEP_DISCOVERY_URL?.trim();
  if (!discovery) return;
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
  const shouldSend = process.argv.includes('--send');
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }
  if (shouldSend && process.env.SAEP_TREASURY_YIELD_SEND_ACK !== SEND_ACK) {
    throw new Error(`--send requires SAEP_TREASURY_YIELD_SEND_ACK=${SEND_ACK}`);
  }

  const agentDidHex = requiredEnv('SAEP_TREASURY_AGENT_DID_HEX').replace(/^0x/, '').toLowerCase();
  const strategyIdHex = requiredEnv('SAEP_TREASURY_STRATEGY_ID_HEX').replace(/^0x/, '').toLowerCase();
  const underlyingMint = new PublicKey(requiredEnv('SAEP_TREASURY_UNDERLYING_MINT'));
  const receiptMint = new PublicKey(requiredEnv('SAEP_TREASURY_RECEIPT_MINT'));
  const kaminoProgram = new PublicKey(requiredEnv('SAEP_TREASURY_KAMINO_PROGRAM'));
  const depositAmount = process.env.SAEP_TREASURY_DEPOSIT_AMOUNT?.trim() || '1000000';
  const withdrawReceipts = process.env.SAEP_TREASURY_WITHDRAW_RECEIPTS?.trim() || depositAmount;

  if (!/^[1-9][0-9]*$/.test(depositAmount) || !/^[1-9][0-9]*$/.test(withdrawReceipts)) {
    throw new Error('deposit and withdraw amounts must be positive integer base units');
  }

  const wallet = shouldSend ? loadWallet(requiredEnv('ANCHOR_WALLET')) : readOnlyWallet();
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
  const common = {
    agentDid: bytesFromHex(agentDidHex, 'SAEP_TREASURY_AGENT_DID_HEX'),
    strategyId: bytesFromHex(strategyIdHex, 'SAEP_TREASURY_STRATEGY_ID_HEX'),
    mint: underlyingMint,
    receiptMint,
    kaminoProgram,
  };
  const routeInput = {
    agentDidHex,
    strategyIdHex,
    underlyingMint: underlyingMint.toBase58(),
    receiptMint: receiptMint.toBase58(),
    strategyProgram: kaminoProgram.toBase58(),
  };

  console.log(`cluster: devnet`);
  console.log(`rpc:     ${config.endpoint}`);
  console.log(`wallet:  ${provider.wallet.publicKey.toBase58()}${shouldSend ? '' : ' (read-only dry run)'}`);
  console.log(`agent:   ${agentDidHex}`);
  console.log(`strategy:${strategyIdHex}`);

  await maybeDiscoverySnapshot(agentDidHex, 'before');
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
  await maybeDiscoverySnapshot(agentDidHex, 'after');

  if (!shouldSend) {
    console.log('\ndry run complete. Re-run with --send and explicit ACK to submit devnet transactions.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.error('\n' + usage());
  process.exit(1);
});
