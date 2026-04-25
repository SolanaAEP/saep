import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import {
  buildRegisterYieldStrategyIx,
  buildSetTreasuryYieldConfigIx,
  buildSetYieldStrategyStatusIx,
  resolveCluster,
  treasuryGlobalPda,
  treasuryPda,
  treasuryStandardProgram,
  treasuryYieldConfigPda,
  treasuryYieldStrategyPda,
} from '@saep/sdk';

const SEND_ACK = 'I_UNDERSTAND_DEVNET_TREASURY_YIELD_BOOTSTRAP';
const DEFAULT_KAMINO_LEND_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const DEFAULT_STRATEGY_LABEL = 'kamino-usdc-devnet';

function usage(): string {
  return [
    'Usage: pnpm bootstrap:devnet-treasury-yield [--send]',
    '',
    'Required to register the strategy:',
    '  SAEP_TREASURY_UNDERLYING_MINT       USDC/underlying mint public key',
    '  SAEP_TREASURY_RECEIPT_MINT          Kamino receipt mint public key',
    '',
    'Optional:',
    '  SAEP_TREASURY_STRATEGY_ID_HEX       32-byte strategy id hex',
    `  SAEP_TREASURY_STRATEGY_LABEL        Strategy id seed label (default: ${DEFAULT_STRATEGY_LABEL})`,
    `  SAEP_TREASURY_KAMINO_PROGRAM        Kamino program id (default: ${DEFAULT_KAMINO_LEND_PROGRAM})`,
    '  SAEP_TREASURY_YIELD_MAX_BPS         Strategy max allocation bps (default: 2500)',
    '  SAEP_TREASURY_YIELD_CONFIG_BPS      Per-treasury allocation bps (default: max bps)',
    '  SAEP_TREASURY_AGENT_DID_HEX         Optional treasury agent DID to configure after registration',
    '  SAEP_TREASURY_YIELD_NAME            Strategy display name',
    '  SAEP_TREASURY_YIELD_METADATA_URI    Strategy metadata URI',
    '  ANCHOR_PROVIDER_URL                 RPC URL (default: devnet)',
    '  ANCHOR_WALLET                       Authority/operator keypair path, required with --send',
    '',
    'Safety:',
    `  --send also requires SAEP_TREASURY_YIELD_BOOTSTRAP_ACK=${SEND_ACK}`,
    '  Without --send this only validates state and builds the setup transaction.',
    '  The script auto-loads .env.local and .env from the repo root.',
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

function optionalEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function loadWallet(path: string): anchor.Wallet {
  if (!existsSync(path)) throw new Error(`ANCHOR_WALLET does not exist: ${path}`);
  const secret = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(secret)));
}

function readOnlyWallet(): anchor.Wallet {
  return new anchor.Wallet(Keypair.generate());
}

function strategyId(): Uint8Array {
  const explicit = optionalEnv('SAEP_TREASURY_STRATEGY_ID_HEX')?.replace(/^0x/, '');
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) {
      throw new Error('SAEP_TREASURY_STRATEGY_ID_HEX must be 32-byte hex');
    }
    return Uint8Array.from(explicit.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
  }
  return createHash('sha256').update(optionalEnv('SAEP_TREASURY_STRATEGY_LABEL') ?? DEFAULT_STRATEGY_LABEL).digest();
}

function bytesFromHex(value: string, label: string): Uint8Array {
  const clean = value.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`${label} must be 32-byte hex`);
  }
  return Uint8Array.from(clean.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
}

function variantName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return Object.keys(value as Record<string, unknown>)[0]?.toLowerCase() ?? '';
}

function parseBps(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer bps value`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error(`${name} must be between 0 and 10000`);
  }
  return parsed;
}

async function sendOrDescribe(
  provider: anchor.AnchorProvider,
  label: string,
  instructions: TransactionInstruction[],
  shouldSend: boolean,
): Promise<string | null> {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = provider.wallet.publicKey;
  const { blockhash } = await provider.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  const metaCount = instructions.reduce((sum, ix) => sum + ix.keys.length, 0);
  console.log(`${label}: built tx with ${instructions.length} instruction(s), ${metaCount} total account metas`);
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
  if (shouldSend && optionalEnv('SAEP_TREASURY_YIELD_BOOTSTRAP_ACK') !== SEND_ACK) {
    throw new Error(`--send requires SAEP_TREASURY_YIELD_BOOTSTRAP_ACK=${SEND_ACK}`);
  }

  const config = resolveCluster({
    cluster: 'devnet',
    endpoint: optionalEnv('ANCHOR_PROVIDER_URL') ?? undefined,
  });
  const walletPath = optionalEnv('ANCHOR_WALLET');
  const wallet = shouldSend ? loadWallet(requiredEnv('ANCHOR_WALLET')) : walletPath ? loadWallet(walletPath) : readOnlyWallet();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(config.endpoint, 'confirmed'),
    wallet,
    { commitment: 'confirmed', preflightCommitment: 'processed', maxRetries: 5 },
  );
  const program = treasuryStandardProgram(provider, config);

  const [global] = treasuryGlobalPda(program.programId);
  const globalInfo = await provider.connection.getAccountInfo(global, 'confirmed');
  if (!globalInfo) {
    throw new Error(
      `treasury global is not initialized on devnet (${global.toBase58()}); initialize treasury_standard before bootstrapping yield`,
    );
  }
  const globalAccount = await program.account.treasuryGlobal.fetch(global);
  const authority = (globalAccount as { authority: PublicKey }).authority;
  if (shouldSend && !authority.equals(provider.wallet.publicKey)) {
    throw new Error(
      `ANCHOR_WALLET ${provider.wallet.publicKey.toBase58()} is not treasury global authority ${authority.toBase58()}`,
    );
  }

  const id = strategyId();
  const idHex = Buffer.from(id).toString('hex');
  const strategyProgram = new PublicKey(optionalEnv('SAEP_TREASURY_KAMINO_PROGRAM') ?? DEFAULT_KAMINO_LEND_PROGRAM);
  const underlyingMint = new PublicKey(requiredEnv('SAEP_TREASURY_UNDERLYING_MINT'));
  const receiptMint = new PublicKey(requiredEnv('SAEP_TREASURY_RECEIPT_MINT'));
  const maxAllocationBps = parseBps('SAEP_TREASURY_YIELD_MAX_BPS', 2_500);
  const configBps = parseBps('SAEP_TREASURY_YIELD_CONFIG_BPS', maxAllocationBps);
  const name = optionalEnv('SAEP_TREASURY_YIELD_NAME') ?? 'Kamino USDC lend';
  const metadataUri = optionalEnv('SAEP_TREASURY_YIELD_METADATA_URI') ?? 'https://buildonsaep.com/docs/treasury#kamino';
  const [strategyPda] = treasuryYieldStrategyPda(program.programId, id);
  const strategyInfo = await provider.connection.getAccountInfo(strategyPda, 'confirmed');

  const instructions: TransactionInstruction[] = [];
  if (!strategyInfo) {
    instructions.push(
      await buildRegisterYieldStrategyIx(program, {
        authority,
        strategyId: id,
        venue: 'kamino',
        strategyProgram,
        underlyingMint,
        receiptMint,
        maxAllocationBps,
        riskTier: 'conservative',
        name,
        metadataUri,
      }),
    );
  } else {
    const strategy = await program.account.yieldStrategyDescriptor.fetch(strategyPda);
    const status = variantName((strategy as { status: unknown }).status);
    console.log(`strategy: already exists (${strategyPda.toBase58()}, status=${status || 'unknown'})`);
    if (status && status !== 'active') {
      instructions.push(await buildSetYieldStrategyStatusIx(program, { authority, strategyId: id, status: 'active' }));
    }
  }

  const agentDidHex = optionalEnv('SAEP_TREASURY_AGENT_DID_HEX');
  if (agentDidHex) {
    const agentDid = bytesFromHex(agentDidHex, 'SAEP_TREASURY_AGENT_DID_HEX');
    const [treasury] = treasuryPda(program.programId, agentDid);
    const treasuryInfo = await provider.connection.getAccountInfo(treasury, 'confirmed');
    if (!treasuryInfo) {
      throw new Error(`agent treasury is not initialized for SAEP_TREASURY_AGENT_DID_HEX (${treasury.toBase58()})`);
    }
    const treasuryAccount = await program.account.agentTreasury.fetch(treasury);
    const treasuryOperator = (treasuryAccount as { operator: PublicKey }).operator;
    if (!treasuryOperator.equals(provider.wallet.publicKey)) {
      throw new Error(
        `ANCHOR_WALLET ${provider.wallet.publicKey.toBase58()} is not treasury operator ${treasuryOperator.toBase58()}`,
      );
    }
    const [yieldConfig] = treasuryYieldConfigPda(program.programId, agentDid);
    instructions.push(
      await buildSetTreasuryYieldConfigIx(program, {
        operator: provider.wallet.publicKey,
        agentDid,
        strategyId: id,
        allocationBps: configBps,
        paused: false,
      }),
    );
    console.log(`yield config: ${yieldConfig.toBase58()} (${configBps} bps)`);
  } else {
    console.log('yield config: skipped; set SAEP_TREASURY_AGENT_DID_HEX to configure a treasury after strategy registration');
  }

  console.log(`cluster: devnet`);
  console.log(`rpc:     ${config.endpoint}`);
  console.log(`wallet:  ${provider.wallet.publicKey.toBase58()}${shouldSend ? '' : ' (read-only dry run)'}`);
  console.log(`authority:${authority.toBase58()}`);
  console.log(`strategy:${idHex}`);
  console.log(`strategy account: ${strategyPda.toBase58()}`);
  console.log(`underlying mint:  ${underlyingMint.toBase58()}`);
  console.log(`receipt mint:     ${receiptMint.toBase58()}`);
  console.log(`kamino program:   ${strategyProgram.toBase58()}`);

  if (instructions.length === 0) {
    console.log('bootstrap complete: no setup transaction needed');
    return;
  }
  const signature = await sendOrDescribe(provider, 'treasury-yield-bootstrap', instructions, shouldSend);
  if (signature) console.log(`bootstrap signature: ${signature}`);
  if (!shouldSend) {
    console.log('\ndry run complete. Re-run with --send and explicit ACK to submit devnet setup.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.error('\n' + usage());
  process.exit(1);
});
