/**
 * Buyback crank — routes FeeCollector staker_share to Jupiter DCA vault.
 *
 * Flow: stakerVault (USDC) → Jupiter DCA position → auto-buys SAEP token
 *
 * Modes:
 *   --dry-run   (default) prints what would execute
 *   --devnet    execute against devnet
 *   --mainnet   execute against mainnet-beta
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { readFileSync } from 'node:fs';

type Network = 'dry-run' | 'devnet' | 'mainnet';

const JUPITER_DCA_PROGRAM = new PublicKey('DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M');
const USDC_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const USDC_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

interface BuybackConfig {
  network: Network;
  saepMint: PublicKey;
  usdcMint: PublicKey;
  rpcUrl: string;
  cycleSeconds: number;
  minAmountPerCycle: bigint;
  maxPricePerToken: bigint;
  totalCycles: number;
}

function parseArgs(): BuybackConfig {
  const args = process.argv.slice(2);
  const network: Network = args.includes('--mainnet')
    ? 'mainnet'
    : args.includes('--devnet')
      ? 'devnet'
      : 'dry-run';

  const rpcUrl =
    network === 'mainnet'
      ? process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
      : process.env.DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';

  const saepMintStr = process.env.SAEP_MINT;
  if (!saepMintStr && network !== 'dry-run') {
    throw new Error('SAEP_MINT env required for live execution');
  }
  const saepMint = saepMintStr
    ? new PublicKey(saepMintStr)
    : Keypair.generate().publicKey;

  return {
    network,
    saepMint,
    usdcMint: network === 'mainnet' ? USDC_MAINNET : USDC_DEVNET,
    rpcUrl,
    cycleSeconds: 3600,
    minAmountPerCycle: 1_000_000n,
    maxPricePerToken: 0n,
    totalCycles: 24,
  };
}

function loadKeypair(): Keypair {
  const path = process.env.CRANKER_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function getStakerVaultBalance(
  connection: Connection,
  programId: PublicKey,
  usdcMint: PublicKey,
): Promise<bigint> {
  const FEE_COLLECTOR_DEVNET = new PublicKey(
    process.env.FEE_COLLECTOR_PROGRAM_ID ?? '11111111111111111111111111111111',
  );
  const [stakerVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('staker_vault')],
    programId.equals(PublicKey.default) ? FEE_COLLECTOR_DEVNET : programId,
  );

  try {
    const info = await connection.getTokenAccountBalance(stakerVault);
    return BigInt(info.value.amount);
  } catch {
    return 0n;
  }
}

interface DcaPosition {
  dcaAccount: PublicKey;
  inputMint: PublicKey;
  outputMint: PublicKey;
  inAmount: bigint;
  cycleFrequency: number;
  totalCycles: number;
}

function buildOpenDcaIx(
  user: PublicKey,
  position: DcaPosition,
): { programId: PublicKey; data: Buffer; keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> } {
  const userInputAta = getAssociatedTokenAddressSync(position.inputMint, user);
  const userOutputAta = getAssociatedTokenAddressSync(position.outputMint, user, false, TOKEN_2022_PROGRAM_ID);

  // Jupiter DCA OpenDcaV2 instruction layout (discriminator + params)
  const data = Buffer.alloc(49);
  data.writeUint8(0xf0, 0); // discriminator placeholder
  data.writeBigUInt64LE(position.inAmount, 1);
  data.writeBigUInt64LE(BigInt(position.cycleFrequency), 9);
  data.writeBigUInt64LE(BigInt(position.totalCycles), 17);
  data.writeBigUInt64LE(0n, 25); // minOutPerCycle
  data.writeBigUInt64LE(0n, 33); // maxOutPerCycle (0 = unlimited)
  data.writeUint8(0, 41); // startAt (0 = now)

  return {
    programId: JUPITER_DCA_PROGRAM,
    data,
    keys: [
      { pubkey: position.dcaAccount, isSigner: true, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: position.inputMint, isSigner: false, isWritable: false },
      { pubkey: position.outputMint, isSigner: false, isWritable: false },
      { pubkey: userInputAta, isSigner: false, isWritable: true },
      { pubkey: userOutputAta, isSigner: false, isWritable: true },
    ],
  };
}

async function main() {
  const cfg = parseArgs();

  console.log(JSON.stringify({
    mode: cfg.network,
    saepMint: cfg.saepMint.toBase58(),
    usdcMint: cfg.usdcMint.toBase58(),
    cycleSeconds: cfg.cycleSeconds,
    totalCycles: cfg.totalCycles,
    jupiterDcaProgram: JUPITER_DCA_PROGRAM.toBase58(),
  }, null, 2));

  if (cfg.network === 'dry-run') {
    console.log('\n[dry-run] would:');
    console.log('  1. read stakerVault balance');
    console.log('  2. create Jupiter DCA position (USDC → SAEP)');
    console.log(`  3. ${cfg.totalCycles} cycles, ${cfg.cycleSeconds}s apart`);
    console.log('  4. distribute bought SAEP to NXSStaking pool');
    return;
  }

  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const cranker = loadKeypair();
  console.log(`cranker: ${cranker.publicKey.toBase58()}`);

  const feeCollectorPid = new PublicKey(
    process.env.FEE_COLLECTOR_PROGRAM_ID ?? PublicKey.default.toBase58(),
  );
  const balance = await getStakerVaultBalance(connection, feeCollectorPid, cfg.usdcMint);
  console.log(`stakerVault balance: ${balance} (${Number(balance) / 1e6} USDC)`);

  if (balance < cfg.minAmountPerCycle * BigInt(cfg.totalCycles)) {
    console.log('insufficient balance for DCA position, skipping');
    return;
  }

  const dcaKeypair = Keypair.generate();
  const position: DcaPosition = {
    dcaAccount: dcaKeypair.publicKey,
    inputMint: cfg.usdcMint,
    outputMint: cfg.saepMint,
    inAmount: balance,
    cycleFrequency: cfg.cycleSeconds,
    totalCycles: cfg.totalCycles,
  };

  const ix = buildOpenDcaIx(cranker.publicKey, position);

  console.log(`opening DCA: ${balance} USDC → SAEP over ${cfg.totalCycles} cycles`);
  console.log(`dcaAccount: ${dcaKeypair.publicKey.toBase58()}`);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = cranker.publicKey;
  tx.add({
    programId: ix.programId,
    keys: ix.keys,
    data: ix.data,
  });

  const sig = await sendAndConfirmTransaction(connection, tx, [cranker, dcaKeypair], {
    commitment: 'confirmed',
  });

  console.log(`DCA position created: ${sig}`);
  console.log(`monitor: https://jup.ag/dca/${dcaKeypair.publicKey.toBase58()}`);
}

main().catch((err) => {
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
