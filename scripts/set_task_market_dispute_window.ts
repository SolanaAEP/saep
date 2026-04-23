import * as anchor from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w');

type CliOptions = {
  secs: bigint;
  help: boolean;
};

function usage(): string {
  return [
    'Usage: pnpm exec tsx scripts/set_task_market_dispute_window.ts --secs <seconds>',
    '',
    'Options:',
    '  --secs <seconds>   New dispute window in seconds (must be > 0)',
    '  --help             Show this help text',
  ].join('\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    secs: 0n,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--secs':
        options.secs = BigInt(argv[++i] ?? '0');
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!options.help && options.secs <= 0n) {
    throw new Error(`--secs must be > 0\n\n${usage()}`);
  }

  return options;
}

function marketGlobalPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('market_global')], PROGRAM_ID);
}

function instructionDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function encodeI64LE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

function isBlockhashNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Blockhash not found');
}

async function sendWithRetry(
  provider: anchor.AnchorProvider,
  ix: TransactionInstruction,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await provider.sendAndConfirm(new anchor.web3.Transaction().add(ix), []);
    } catch (error) {
      lastError = error;
      if (!isBlockhashNotFound(error) || attempt === 4) {
        throw error;
      }
      console.warn(`dispute-window:update blockhash expired during preflight, retrying (${attempt}/4)...`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 400));
    }
  }
  throw lastError;
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

  const [global] = marketGlobalPda();
  const authority = provider.wallet.publicKey;
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: global, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      instructionDiscriminator('set_dispute_window_secs'),
      encodeI64LE(options.secs),
    ]),
  });

  const conn = provider.connection;
  const before = await conn.getAccountInfo(global);
  console.log(`market_global: ${global.toBase58()}`);
  console.log(`authority: ${authority.toBase58()}`);
  console.log(`updating dispute window to ${options.secs.toString()} seconds...`);

  const sig = await sendWithRetry(provider, ix);
  console.log(`signature: ${sig}`);
  console.log(`market_global existed before send: ${before !== null}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
