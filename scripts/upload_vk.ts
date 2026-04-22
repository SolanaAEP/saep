import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe');
const DEFAULT_CIRCUIT_LABEL = 'task_completion_v1';
const DEFAULT_VK_PATH = resolve(
  __dirname,
  '../circuits/task_completion/build/verification_key.json',
);
const IDL_CANDIDATES = [
  resolve(__dirname, '../target/idl/proof_verifier.json'),
  resolve(__dirname, '../packages/sdk/src/idl/proof_verifier.json'),
  resolve(__dirname, '../services/indexer/idl/proof_verifier.json'),
];

function configPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('verifier_config')], PROGRAM_ID);
}

function modePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('mode')], PROGRAM_ID);
}

function vkPda(vkId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vk'), Buffer.from(vkId)],
    PROGRAM_ID,
  );
}

function fieldElementToBytes(decimal: string): Buffer {
  let n = BigInt(decimal);
  const buf = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

function g1ToBytes(point: [string, string, string]): number[] {
  const x = fieldElementToBytes(point[0]);
  const y = fieldElementToBytes(point[1]);
  return [...x, ...y];
}

function g2ToBytes(point: [[string, string], [string, string], [string, string]]): number[] {
  // snarkjs stores Fp2 as [real, imaginary]
  // Ethereum precompile expects [imaginary, real] per coordinate
  const x_im = fieldElementToBytes(point[0][1]);
  const x_re = fieldElementToBytes(point[0][0]);
  const y_im = fieldElementToBytes(point[1][1]);
  const y_re = fieldElementToBytes(point[1][0]);
  return [...x_im, ...x_re, ...y_im, ...y_re];
}

function padLabel(s: string): number[] {
  const buf = Buffer.alloc(32, 0);
  Buffer.from(s, 'utf8').copy(buf);
  return Array.from(buf);
}

function computeVkId(label: string): Buffer {
  return createHash('sha256').update(label).digest();
}

interface SnarkjsVK {
  nPublic: number;
  vk_alpha_1: [string, string, string];
  vk_beta_2: [[string, string], [string, string], [string, string]];
  vk_gamma_2: [[string, string], [string, string], [string, string]];
  vk_delta_2: [[string, string], [string, string], [string, string]];
  IC: [string, string, string][];
}

interface VkMeta {
  status?: string;
  is_production?: boolean;
  production?: boolean;
  warning?: string;
  ceremony?: string;
}

interface CliOptions {
  vkPath: string;
  metaPath?: string;
  circuitLabel: string;
  isProduction?: boolean;
  initIsMainnet?: boolean;
  proposeActivation: boolean;
  force: boolean;
  help: boolean;
}

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/upload_vk.ts [options]',
    '',
    'Options:',
    '  --vk-path <path>          Verification key JSON path',
    '  --meta-path <path>        Verification key metadata JSON path',
    '  --label <label>           Circuit label used to derive vk_id',
    '  --production              Mark uploaded VK as production',
    '  --dev                     Mark uploaded VK as dev-only',
    '  --mainnet                 If init_config is missing, initialize mode.is_mainnet = true',
    '  --devnet                  If init_config is missing, initialize mode.is_mainnet = false',
    '  --propose-activation      Propose activation even when rotating from an existing active VK',
    '  --force                   Override safety checks like dev-only metadata on mainnet',
    '  --help                    Show this help text',
    '',
    'Defaults:',
    `  vk-path = ${DEFAULT_VK_PATH}`,
    `  label = ${DEFAULT_CIRCUIT_LABEL}`,
    '  production/dev flag inferred from sibling *.meta.json when present',
    '',
    'Examples:',
    '  pnpm exec tsx scripts/upload_vk.ts',
    '  pnpm exec tsx scripts/upload_vk.ts --mainnet --production --vk-path /path/to/verification_key.json --meta-path /path/to/verification_key.meta.json --propose-activation',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    vkPath: DEFAULT_VK_PATH,
    circuitLabel: DEFAULT_CIRCUIT_LABEL,
    proposeActivation: false,
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--vk-path':
        options.vkPath = resolve(argv[++i] ?? '');
        break;
      case '--meta-path':
        options.metaPath = resolve(argv[++i] ?? '');
        break;
      case '--label':
        options.circuitLabel = argv[++i] ?? '';
        break;
      case '--production':
        options.isProduction = true;
        break;
      case '--dev':
        options.isProduction = false;
        break;
      case '--mainnet':
        options.initIsMainnet = true;
        break;
      case '--devnet':
        options.initIsMainnet = false;
        break;
      case '--propose-activation':
        options.proposeActivation = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!options.vkPath) {
    throw new Error(`Missing --vk-path value\n\n${usage()}`);
  }
  if (!options.circuitLabel) {
    throw new Error(`Missing --label value\n\n${usage()}`);
  }
  if (options.metaPath === '') {
    throw new Error(`Missing --meta-path value\n\n${usage()}`);
  }
  if (options.isProduction === true && options.initIsMainnet === false) {
    console.warn('WARN: uploading a production VK while --devnet was supplied.');
  }

  return options;
}

function defaultMetaPathFor(vkPath: string): string {
  const dir = dirname(vkPath);
  const filename = basename(vkPath);
  return resolve(
    dir,
    filename.endsWith('.json')
      ? `${filename.slice(0, -'.json'.length)}.meta.json`
      : 'verification_key.meta.json',
  );
}

function inferProductionFromMeta(
  metaPath: string,
): { meta: VkMeta | null; inferred: boolean | undefined } {
  if (!existsSync(metaPath)) {
    return { meta: null, inferred: undefined };
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as VkMeta;
  if (typeof meta.is_production === 'boolean') {
    return { meta, inferred: meta.is_production };
  }
  if (typeof meta.production === 'boolean') {
    return { meta, inferred: meta.production };
  }
  if (typeof meta.status === 'string') {
    const normalized = meta.status.trim().toLowerCase();
    if (normalized === 'dev-only' || normalized === 'dev' || normalized === 'test') {
      return { meta, inferred: false };
    }
    if (
      normalized === 'production'
      || normalized === 'prod'
      || normalized === 'mainnet'
      || normalized === 'mainnet-ready'
      || normalized === 'mpc-final'
    ) {
      return { meta, inferred: true };
    }
  }
  return { meta, inferred: undefined };
}

function loadProofVerifierIdl(): { idl: anchor.Idl; path: string } {
  for (const candidate of IDL_CANDIDATES) {
    if (existsSync(candidate)) {
      return {
        idl: JSON.parse(readFileSync(candidate, 'utf-8')) as anchor.Idl,
        path: candidate,
      };
    }
  }
  throw new Error(
    `Could not find proof_verifier IDL. Checked:\n${IDL_CANDIDATES.map((p) => `- ${p}`).join('\n')}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const { idl, path: idlPath } = loadProofVerifierIdl();
  const program = new anchor.Program(idl, provider);
  const authority = provider.wallet;

  const metaPath = options.metaPath ?? defaultMetaPathFor(options.vkPath);
  const { meta, inferred } = inferProductionFromMeta(metaPath);
  const isProduction = options.isProduction ?? inferred;
  if (typeof isProduction !== 'boolean') {
    throw new Error(
      `Could not determine whether the VK is production or dev-only. `
      + `Pass --production or --dev, or provide metadata at ${metaPath}.`,
    );
  }
  if (
    options.isProduction === true
    && meta?.status?.trim().toLowerCase() === 'dev-only'
    && !options.force
  ) {
    throw new Error(
      `Metadata at ${metaPath} marks this VK as dev-only. `
      + `Refusing to override to production without --force.`,
    );
  }

  const vkJson: SnarkjsVK = JSON.parse(readFileSync(options.vkPath, 'utf-8'));

  const vkId = computeVkId(options.circuitLabel);
  const circuitLabel = padLabel(options.circuitLabel);
  const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
  const betaG2 = g2ToBytes(vkJson.vk_beta_2);
  const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
  const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
  const ic = vkJson.IC.map((p) => g1ToBytes(p));
  const numPublicInputs = vkJson.nPublic;

  console.log(`cluster rpc: ${provider.connection.rpcEndpoint}`);
  console.log(`idl path: ${idlPath}`);
  console.log(`circuit: ${options.circuitLabel}`);
  console.log(`vk path: ${options.vkPath}`);
  if (meta) {
    console.log(`meta path: ${metaPath}`);
    if (meta.status) console.log(`meta status: ${meta.status}`);
    if (meta.ceremony) console.log(`meta ceremony: ${meta.ceremony}`);
  } else {
    console.log(`meta path: ${metaPath} (missing)`);
  }
  console.log(`is_production: ${isProduction}`);
  console.log(`vk_id: ${vkId.toString('hex')}`);
  console.log(`public inputs: ${numPublicInputs}`);
  console.log(`IC points: ${ic.length} (expected ${numPublicInputs + 1})`);

  const [configPubkey] = configPda();
  const [modePubkey] = modePda();
  let cfg = await program.account.verifierConfig.fetch(configPubkey).catch(() => null);
  let mode = await program.account.globalMode.fetch(modePubkey).catch(() => null);
  if (!cfg) {
    if (typeof options.initIsMainnet !== 'boolean') {
      throw new Error(
        'Verifier config is missing. Refusing to initialize without an explicit '
        + '--mainnet or --devnet flag.',
      );
    }
    console.log(`initializing verifier config (is_mainnet=${options.initIsMainnet})...`);
    await program.methods
      .initConfig(authority.publicKey, options.initIsMainnet)
      .accountsPartial({ payer: authority.publicKey })
      .rpc({ commitment: 'confirmed' });
    cfg = await program.account.verifierConfig.fetch(configPubkey);
    mode = await program.account.globalMode.fetch(modePubkey);
  }

  console.log(`verifier mode.is_mainnet: ${mode?.isMainnet ?? 'unknown'}`);
  if (mode?.isMainnet && !isProduction && !options.force) {
    throw new Error(
      'Refusing to upload a dev-only VK while the verifier is in mainnet mode. '
      + 'Use --force only if you intentionally want this on-chain but inactive.',
    );
  }

  const [vkPubkey] = vkPda(vkId);
  const existing = await program.account.verifierKey.fetch(vkPubkey).catch(() => null);

  if (existing && existing.registeredAt.toNumber() > 0) {
    console.log(`VK already finalized at ${vkPubkey.toBase58()}, skipping.`);
  } else {
    if (!existing) {
      console.log('init_vk (header)...');
      await program.methods
        .initVk(
          Array.from(vkId) as unknown as number[],
          alphaG1 as unknown as number[],
          betaG2 as unknown as number[],
          gammaG2 as unknown as number[],
          deltaG2 as unknown as number[],
          numPublicInputs,
          circuitLabel as unknown as number[],
          isProduction,
        )
        .accountsPartial({
          authority: authority.publicKey,
          payer: authority.publicKey,
        })
        .rpc({ commitment: 'confirmed' });
    } else {
      console.log(`resuming append from existing ic.length=${existing.ic.length}`);
    }

    const startIdx = existing ? existing.ic.length : 0;
    const remaining = ic.slice(startIdx);
    console.log(`append_vk_ic (${remaining.length} points, finalize=true)...`);
    await program.methods
      .appendVkIc(remaining as unknown as number[][], true)
      .accountsPartial({ authority: authority.publicKey, vk: vkPubkey })
      .rpc({ commitment: 'confirmed' });
    console.log(`VK registered at ${vkPubkey.toBase58()}`);
  }

  const vkAccount = await program.account.verifierKey.fetch(vkPubkey);
  console.log(`\non-chain VK state:`);
  console.log(`  vk_id: ${Buffer.from(vkAccount.vkId).toString('hex')}`);
  console.log(`  num_public_inputs: ${vkAccount.numPublicInputs}`);
  console.log(`  is_production: ${vkAccount.isProduction}`);
  console.log(`  circuit_label: ${Buffer.from(vkAccount.circuitLabel).toString('utf-8').replace(/\0+$/, '')}`);
  console.log(`  IC length: ${vkAccount.ic.length}`);
  console.log(`  registered_by: ${vkAccount.registeredBy.toBase58()}`);

  cfg = await program.account.verifierConfig.fetch(configPubkey);
  if (cfg.pendingVk?.equals(vkPubkey)) {
    console.log('\nthis VK is already pending activation.');
    console.log(`pending_vk: ${cfg.pendingVk.toBase58()}`);
    console.log(`activates_at: ${new Date(cfg.pendingActivatesAt.toNumber() * 1000).toISOString()}`);
  } else if (cfg.activeVk.equals(vkPubkey)) {
    console.log(`\nactive_vk already set to uploaded VK: ${cfg.activeVk.toBase58()}`);
  } else if (cfg.activeVk.equals(PublicKey.default) || options.proposeActivation) {
    console.log('\nproposing VK activation (7-day timelock)...');
    await program.methods
      .proposeVkActivation()
      .accountsPartial({
        vk: vkPubkey,
        mode: modePubkey,
        authority: authority.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const updatedCfg = await program.account.verifierConfig.fetch(configPubkey);
    console.log(`pending_vk: ${updatedCfg.pendingVk?.toBase58()}`);
    console.log(`activates_at: ${new Date(updatedCfg.pendingActivatesAt.toNumber() * 1000).toISOString()}`);
  } else {
    console.log(`\nactive_vk already set: ${cfg!.activeVk.toBase58()}`);
    if (!cfg!.activeVk.equals(vkPubkey)) {
      console.log('WARNING: active VK differs from the one just registered.');
      console.log('Re-run with --propose-activation to start a 7-day rotation timelock.');
    }
  }

  console.log('\ndone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
