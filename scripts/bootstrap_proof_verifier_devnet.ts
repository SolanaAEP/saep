import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe');
const DEFAULT_ALLOWED_CALLER = new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w');
const DEFAULT_VK_PATH = resolve(
  __dirname,
  '../circuits/task_completion/build/verification_key.json',
);
const DEFAULT_LABEL = 'task_completion_v1';

const IDL_CANDIDATES = [
  resolve(__dirname, '../target/idl/proof_verifier.json'),
  resolve(__dirname, '../packages/sdk/src/idl/proof_verifier.json'),
  resolve(__dirname, '../services/indexer/idl/proof_verifier.json'),
];

type CliOptions = {
  vkPath: string;
  label: string;
  allowedCaller: PublicKey;
  forceReapplyCallers: boolean;
  help: boolean;
};

type SnarkjsVk = {
  nPublic: number;
  vk_alpha_1: [string, string, string];
  vk_beta_2: [[string, string], [string, string], [string, string]];
  vk_gamma_2: [[string, string], [string, string], [string, string]];
  vk_delta_2: [[string, string], [string, string], [string, string]];
  IC: [string, string, string][];
};

function isBlockhashNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Blockhash not found');
}

async function withBlockhashRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isBlockhashNotFound(error) || attempt === 4) {
        throw error;
      }
      console.warn(`${label}: blockhash expired during preflight, retrying (${attempt}/4)...`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 400));
    }
  }
  throw lastError;
}

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/bootstrap_proof_verifier_devnet.ts [options]',
    '',
    'Options:',
    '  --vk-path <path>         Verification key JSON path',
    '  --label <label>          Circuit label used to derive vk_id',
    '  --allowed-caller <pk>    Program id to allow for proof-verifier CPI calls',
    '  --force-reapply-callers  Rewrite allowed callers even if already present',
    '  --help                   Show this help text',
    '',
    `Defaults:`,
    `  --vk-path ${DEFAULT_VK_PATH}`,
    `  --label ${DEFAULT_LABEL}`,
    `  --allowed-caller ${DEFAULT_ALLOWED_CALLER.toBase58()}`,
    '',
    'Notes:',
    '  - Initializes the verifier in non-mainnet mode if config is missing.',
    '  - Creates guard + allowed-callers if missing.',
    '  - Registers the supplied VK if missing.',
    '  - Executes activation immediately only when the first non-mainnet bootstrap path allows it.',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    vkPath: DEFAULT_VK_PATH,
    label: DEFAULT_LABEL,
    allowedCaller: DEFAULT_ALLOWED_CALLER,
    forceReapplyCallers: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--vk-path':
        options.vkPath = resolve(argv[++i] ?? '');
        break;
      case '--label':
        options.label = argv[++i] ?? '';
        break;
      case '--allowed-caller':
        options.allowedCaller = new PublicKey(argv[++i] ?? '');
        break;
      case '--force-reapply-callers':
        options.forceReapplyCallers = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!options.vkPath) throw new Error(`Missing --vk-path value\n\n${usage()}`);
  if (!options.label) throw new Error(`Missing --label value\n\n${usage()}`);
  return options;
}

function loadIdl(): anchor.Idl {
  for (const candidate of IDL_CANDIDATES) {
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf8')) as anchor.Idl;
    }
  }
  throw new Error(
    `Could not find proof_verifier IDL. Checked:\n${IDL_CANDIDATES.map((p) => `- ${p}`).join('\n')}`,
  );
}

function configPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('verifier_config')], PROGRAM_ID);
}

function modePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('mode')], PROGRAM_ID);
}

function guardPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('guard')], PROGRAM_ID);
}

function allowedCallersPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('allowed_callers')], PROGRAM_ID);
}

function vkPda(vkId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vk'), Buffer.from(vkId)], PROGRAM_ID);
}

function computeVkId(label: string): Buffer {
  return createHash('sha256').update(label).digest();
}

function fieldElementToBytes(decimal: string): Buffer {
  let n = BigInt(decimal);
  const buf = Buffer.alloc(32);
  for (let i = 31; i >= 0; i -= 1) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

function g1ToBytes(point: [string, string, string]): number[] {
  return [...fieldElementToBytes(point[0]), ...fieldElementToBytes(point[1])];
}

function g2ToBytes(point: [[string, string], [string, string], [string, string]]): number[] {
  const xIm = fieldElementToBytes(point[0][1]);
  const xRe = fieldElementToBytes(point[0][0]);
  const yIm = fieldElementToBytes(point[1][1]);
  const yRe = fieldElementToBytes(point[1][0]);
  return [...xIm, ...xRe, ...yIm, ...yRe];
}

function padLabel(label: string): number[] {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(label, 'utf8').copy(buf);
  return Array.from(buf);
}

function loadVk(path: string): SnarkjsVk {
  return JSON.parse(readFileSync(path, 'utf8')) as SnarkjsVk;
}

async function ensureConfig(
  program: anchor.Program,
  authority: PublicKey,
): Promise<void> {
  const [configPubkey] = configPda();
  const configInfo = await program.provider.connection.getAccountInfo(configPubkey);
  if (configInfo) {
    console.log(`config: already exists (${configPubkey.toBase58()})`);
    return;
  }

  console.log('config: initializing in non-mainnet mode...');
  await withBlockhashRetry('config:init', () =>
    program.methods
      .initConfig(authority, false)
      .accountsPartial({ payer: authority })
      .rpc({ commitment: 'confirmed' }),
  );
}

async function ensureGuard(
  program: anchor.Program,
  authority: PublicKey,
  allowedCaller: PublicKey,
  forceReapply: boolean,
): Promise<void> {
  const [guardPubkey] = guardPda();
  const [allowedPubkey] = allowedCallersPda();
  const conn = program.provider.connection;
  const [guardInfo, allowedInfo] = await Promise.all([
    conn.getAccountInfo(guardPubkey),
    conn.getAccountInfo(allowedPubkey),
  ]);

  if (!guardInfo && !allowedInfo) {
    console.log('guard: initializing self guard + allowed callers...');
    await withBlockhashRetry('guard:init', () =>
      program.methods
        .initGuard([allowedCaller])
        .accountsPartial({ authority })
        .rpc({ commitment: 'confirmed' }),
    );
    return;
  }

  if (!guardInfo || !allowedInfo) {
    throw new Error(
      'Verifier guard state is partially initialized. Refusing to continue because guard and '
      + 'allowed-callers PDAs should be created together.',
    );
  }

  const allowed = await program.account.allowedCallers.fetch(allowedPubkey);
  const callers = allowed.programs as PublicKey[];
  const hasCaller = callers.some((caller) => caller.equals(allowedCaller));
  if (!forceReapply && hasCaller) {
    console.log(`guard: allowed caller already present (${allowedCaller.toBase58()})`);
    return;
  }

  const nextCallers = forceReapply
    ? [allowedCaller]
    : [...callers, allowedCaller].filter(
        (caller, index, arr) => arr.findIndex((candidate) => candidate.equals(caller)) === index,
      );

  console.log(`guard: setting allowed callers (${nextCallers.map((caller) => caller.toBase58()).join(', ')})...`);
  await withBlockhashRetry('guard:set-allowed-callers', () =>
    program.methods
      .setAllowedCallers(nextCallers)
      .accountsPartial({ authority })
      .rpc({ commitment: 'confirmed' }),
  );
}

async function ensureVk(
  program: anchor.Program,
  authority: PublicKey,
  options: CliOptions,
): Promise<{ vkPubkey: PublicKey; vkId: Buffer }> {
  const vkJson = loadVk(options.vkPath);
  const vkId = computeVkId(options.label);
  const [vkPubkey] = vkPda(vkId);
  const existing = await program.account.verifierKey.fetch(vkPubkey).catch(() => null);

  if (existing && existing.registeredAt.toNumber() > 0) {
    console.log(`vk: already registered (${vkPubkey.toBase58()})`);
    return { vkPubkey, vkId };
  }

  const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
  const betaG2 = g2ToBytes(vkJson.vk_beta_2);
  const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
  const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
  const ic = vkJson.IC.map((point) => g1ToBytes(point));
  const circuitLabel = padLabel(options.label);

  if (!existing) {
    console.log('vk: init header...');
    await withBlockhashRetry('vk:init', () =>
      program.methods
        .initVk(
          Array.from(vkId),
          alphaG1,
          betaG2,
          gammaG2,
          deltaG2,
          vkJson.nPublic,
          circuitLabel,
          false,
        )
        .accountsPartial({
          authority,
          payer: authority,
        })
        .rpc({ commitment: 'confirmed' }),
    );
  }

  const startIdx = existing ? existing.ic.length : 0;
  const remaining = ic.slice(startIdx);
  if (remaining.length > 0) {
    console.log(`vk: append IC (${remaining.length} points)...`);
    await withBlockhashRetry('vk:append-ic', () =>
      program.methods
        .appendVkIc(remaining, true)
        .accountsPartial({ authority, vk: vkPubkey })
        .rpc({ commitment: 'confirmed' }),
    );
  }

  console.log(`vk: ready (${vkPubkey.toBase58()})`);
  return { vkPubkey, vkId };
}

async function ensureActivation(program: anchor.Program, authority: PublicKey, vkPubkey: PublicKey): Promise<void> {
  const [configPubkey] = configPda();
  const [modePubkey] = modePda();
  let config = await program.account.verifierConfig.fetch(configPubkey);

  if (config.activeVk.equals(vkPubkey)) {
    console.log(`activation: already active (${vkPubkey.toBase58()})`);
    return;
  }

  if (!config.pendingVk || !config.pendingVk.equals(vkPubkey)) {
    console.log('activation: proposing...');
    await withBlockhashRetry('activation:propose', () =>
      program.methods
        .proposeVkActivation()
        .accountsPartial({
          vk: vkPubkey,
          mode: modePubkey,
          authority,
        })
        .rpc({ commitment: 'confirmed' }),
    );
    config = await program.account.verifierConfig.fetch(configPubkey);
  }

  const now = Math.floor(Date.now() / 1000);
  if (config.pendingActivatesAt.toNumber() > now) {
    console.log(
      `activation: pending until ${new Date(config.pendingActivatesAt.toNumber() * 1000).toISOString()}`,
    );
    return;
  }

  console.log('activation: executing...');
  await withBlockhashRetry('activation:execute', () =>
    program.methods
      .executeVkActivation()
      .accountsPartial({ vk: vkPubkey })
      .rpc({ commitment: 'confirmed' }),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const envProvider = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    envProvider.connection,
    envProvider.wallet,
    {
      commitment: 'confirmed',
      preflightCommitment: 'processed',
      maxRetries: 5,
    },
  );
  anchor.setProvider(provider);
  const authority = provider.wallet.publicKey;
  const program = new anchor.Program(loadIdl(), provider);

  console.log(`cluster rpc: ${provider.connection.rpcEndpoint}`);
  console.log(`authority: ${authority.toBase58()}`);
  console.log(`vk path: ${options.vkPath}`);
  console.log(`label: ${options.label}`);
  console.log(`allowed caller: ${options.allowedCaller.toBase58()}`);

  await ensureConfig(program, authority);
  await ensureGuard(program, authority, options.allowedCaller, options.forceReapplyCallers);
  const { vkPubkey } = await ensureVk(program, authority, options);
  await ensureActivation(program, authority, vkPubkey);

  const [configPubkey] = configPda();
  const config = await program.account.verifierConfig.fetch(configPubkey);
  console.log('final verifier state:');
  console.log(`  active_vk: ${config.activeVk.toBase58()}`);
  console.log(`  pending_vk: ${config.pendingVk?.toBase58() ?? 'none'}`);
  console.log(`  pending_activates_at: ${config.pendingActivatesAt.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
