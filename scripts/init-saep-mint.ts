/**
 * Canonical SAEP Token-2022 mint init — per specs/token2022-saep-mint.md.
 *
 * Modes:
 *   --dry-run (default)  offline build; validates ix sequence + account size; CI-safe
 *   --devnet             send init + metadata + handover against devnet; rehearsal path
 *   --mainnet            refuses unconditionally at M1 per AUTONOMY.md stop list
 *
 * The init tx (steps 1-9) MUST be atomic. Partial init leaves the mint unusable —
 * extension set is frozen after InitializeMint. Handover is a separate atomic tx
 * (step T+1). See spec §Authority handover sequence.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  AuthorityType,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeInstruction as createInitializeMetadataInstruction,
  createInitializeInterestBearingMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializePausableConfigInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createSetAuthorityInstruction,
  getMintLen,
} from '@solana/spl-token';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

type Network = 'dry-run' | 'devnet' | 'mainnet';

const EXTENSIONS: ExtensionType[] = [
  ExtensionType.TransferFeeConfig,
  ExtensionType.TransferHook,
  ExtensionType.PermanentDelegate,
  ExtensionType.InterestBearingConfig,
  ExtensionType.MetadataPointer,
  ExtensionType.PausableConfig,
];

const CONFIG = {
  decimals: 9,
  name: 'SAEP',
  symbol: 'SAEP',
  uri: 'ipfs://saep-metadata/placeholder',
  transferFeeBasisPoints: 10,
  maximumFee: 1_000_000n * 10n ** 9n,
  initialRateBps: 0,
  feeCollectorProgram: new PublicKey('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu'),
  nxsStakingProgram: new PublicKey('GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z'),
  governanceProgram: new PublicKey('9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1'),
} as const;

function configHash(): string {
  const payload = JSON.stringify({
    extensions: EXTENSIONS,
    decimals: CONFIG.decimals,
    name: CONFIG.name,
    symbol: CONFIG.symbol,
    uri: CONFIG.uri,
    transferFeeBasisPoints: CONFIG.transferFeeBasisPoints,
    maximumFee: CONFIG.maximumFee.toString(),
    initialRateBps: CONFIG.initialRateBps,
    feeCollector: CONFIG.feeCollectorProgram.toBase58(),
    nxsStaking: CONFIG.nxsStakingProgram.toBase58(),
    governance: CONFIG.governanceProgram.toBase58(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function feeCollectorAuthorityPda(seed: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], CONFIG.feeCollectorProgram)[0];
}

function nxsStakingAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('apy_authority')],
    CONFIG.nxsStakingProgram,
  )[0];
}

function governanceAuthorityPda(seed: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], CONFIG.governanceProgram)[0];
}

function buildInitInstructions(mint: PublicKey, bootstrap: PublicKey, mintLen: number, rentLamports: number): TransactionInstruction[] {
  return [
    SystemProgram.createAccount({
      fromPubkey: bootstrap,
      newAccountPubkey: mint,
      lamports: rentLamports,
      space: mintLen,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(mint, bootstrap, mint, TOKEN_2022_PROGRAM_ID),
    createInitializeTransferFeeConfigInstruction(
      mint,
      bootstrap,
      bootstrap,
      CONFIG.transferFeeBasisPoints,
      CONFIG.maximumFee,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeTransferHookInstruction(mint, bootstrap, CONFIG.feeCollectorProgram, TOKEN_2022_PROGRAM_ID),
    createInitializePermanentDelegateInstruction(mint, bootstrap, TOKEN_2022_PROGRAM_ID),
    createInitializeInterestBearingMintInstruction(mint, bootstrap, CONFIG.initialRateBps, TOKEN_2022_PROGRAM_ID),
    createInitializePausableConfigInstruction(mint, bootstrap, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, CONFIG.decimals, bootstrap, bootstrap, TOKEN_2022_PROGRAM_ID),
  ];
}

function buildMetadataInstruction(mint: PublicKey, bootstrap: PublicKey): TransactionInstruction {
  return createInitializeMetadataInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    metadata: mint,
    updateAuthority: bootstrap,
    mint,
    mintAuthority: bootstrap,
    name: CONFIG.name,
    symbol: CONFIG.symbol,
    uri: CONFIG.uri,
  });
}

function buildHandoverInstructions(mint: PublicKey, bootstrap: PublicKey, targets: HandoverTargets): TransactionInstruction[] {
  return [
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.FreezeAccount, null, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.TransferFeeConfig, targets.programCouncil, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.WithheldWithdraw, targets.withheldWithdraw, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.TransferHookProgramId, targets.transferHook, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.PermanentDelegate, targets.programCouncil, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.InterestRate, targets.interestRate, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.MetadataPointer, targets.programCouncil, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint, bootstrap, AuthorityType.PausableConfig, targets.emergencyCouncil, [], TOKEN_2022_PROGRAM_ID),
  ];
}

type HandoverTargets = {
  programCouncil: PublicKey;
  emergencyCouncil: PublicKey;
  withheldWithdraw: PublicKey;
  transferHook: PublicKey;
  interestRate: PublicKey;
};

function devnetHandoverTargets(bootstrap: PublicKey): HandoverTargets {
  return {
    programCouncil: bootstrap,
    emergencyCouncil: bootstrap,
    withheldWithdraw: feeCollectorAuthorityPda('transfer_fee_withdraw_authority'),
    transferHook: governanceAuthorityPda('transfer_hook_authority'),
    interestRate: nxsStakingAuthorityPda(),
  };
}

type StateFile = {
  network: Exclude<Network, 'dry-run'>;
  mintPubkey: string;
  bootstrapPubkey: string;
  initTxSig: string;
  metadataTxSig: string;
  handoverTxSig: string;
  slot: number;
  configHash: string;
  timestamp: string;
};

function stateFilePath(network: Network): string {
  return resolve(process.cwd(), 'state', `saep-mint-${network}.json`);
}

function readStateFile(network: Network): StateFile | null {
  const path = stateFilePath(network);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as StateFile;
}

function writeStateFile(network: Network, state: StateFile): void {
  const dir = resolve(process.cwd(), 'state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(stateFilePath(network), JSON.stringify(state, null, 2) + '\n');
}

function loadKeypairFromPath(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function parseArgs(argv: string[]): { mode: Network; confirmMainnet: boolean; forceReinit: boolean; keypairPath?: string; rpcUrl?: string } {
  const args = { mode: 'dry-run' as Network, confirmMainnet: false, forceReinit: false, keypairPath: undefined as string | undefined, rpcUrl: undefined as string | undefined };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.mode = 'dry-run';
    else if (a === '--devnet') args.mode = 'devnet';
    else if (a === '--mainnet') args.mode = 'mainnet';
    else if (a === '--confirm-mainnet') args.confirmMainnet = true;
    else if (a === '--force-reinit-rehearsal') args.forceReinit = true;
    else if (a === '--keypair') args.keypairPath = argv[++i];
    else if (a === '--rpc-url') args.rpcUrl = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

function ixDescriptors(ixs: TransactionInstruction[]): { pid: string; dataLen: number; accounts: number }[] {
  return ixs.map((ix) => ({ pid: ix.programId.toBase58(), dataLen: ix.data.length, accounts: ix.keys.length }));
}

async function runDryRun(): Promise<void> {
  const mint = Keypair.generate().publicKey;
  const bootstrap = Keypair.generate().publicKey;
  const mintLen = getMintLen(EXTENSIONS);
  const rentLamports = Math.ceil(mintLen * 6960);

  const initIxs = buildInitInstructions(mint, bootstrap, mintLen, rentLamports);
  const metadataIx = buildMetadataInstruction(mint, bootstrap);
  const handoverIxs = buildHandoverInstructions(mint, bootstrap, devnetHandoverTargets(bootstrap));

  const stubBlockhash = '11111111111111111111111111111111';
  const initTx = new Transaction({ feePayer: bootstrap, recentBlockhash: stubBlockhash }).add(...initIxs);
  const metadataTx = new Transaction({ feePayer: bootstrap, recentBlockhash: stubBlockhash }).add(metadataIx);
  const handoverTx = new Transaction({ feePayer: bootstrap, recentBlockhash: stubBlockhash }).add(...handoverIxs);

  const summary = {
    mode: 'dry-run',
    extensions: EXTENSIONS.map((e) => ExtensionType[e]),
    mintAccountBytes: mintLen,
    rentLamportsEstimate: rentLamports,
    rentSolEstimate: rentLamports / LAMPORTS_PER_SOL,
    configHash: configHash(),
    initTx: {
      ixCount: initIxs.length,
      ixs: ixDescriptors(initIxs),
      serializedBytes: initTx.serializeMessage().length,
    },
    metadataTx: {
      ixCount: 1,
      ixs: ixDescriptors([metadataIx]),
      serializedBytes: metadataTx.serializeMessage().length,
    },
    handoverTx: {
      ixCount: handoverIxs.length,
      ixs: ixDescriptors(handoverIxs),
      serializedBytes: handoverTx.serializeMessage().length,
    },
    handoverTargets: Object.fromEntries(
      Object.entries(devnetHandoverTargets(bootstrap)).map(([k, v]) => [k, v.toBase58()]),
    ),
  };

  if (initIxs.length !== 8) throw new Error(`init ix count ${initIxs.length} != 8`);
  if (handoverIxs.length !== 9) throw new Error(`handover ix count ${handoverIxs.length} != 9`);
  if (initTx.serializeMessage().length > 1232) {
    throw new Error(`init tx message ${initTx.serializeMessage().length} bytes > 1232 — split required`);
  }
  if (handoverTx.serializeMessage().length > 1232) {
    throw new Error(`handover tx message ${handoverTx.serializeMessage().length} bytes > 1232 — split required`);
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log('\n[ok] dry-run: ix sequence + sizes validated. no network contact.');
}

async function runDevnet(opts: { keypairPath?: string; rpcUrl?: string; forceReinit: boolean }): Promise<void> {
  if (!opts.keypairPath) throw new Error('--keypair <path> required for --devnet');
  const existing = readStateFile('devnet');
  if (existing && !opts.forceReinit) {
    throw new Error(`state/saep-mint-devnet.json exists (mint ${existing.mintPubkey}). pass --force-reinit-rehearsal to re-init.`);
  }

  const connection = new Connection(opts.rpcUrl ?? 'https://api.devnet.solana.com', 'confirmed');
  const bootstrap = loadKeypairFromPath(opts.keypairPath);
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  const bal = await connection.getBalance(bootstrap.publicKey);
  if (bal < 2 * LAMPORTS_PER_SOL) {
    throw new Error(`bootstrap ${bootstrap.publicKey.toBase58()} balance ${bal / LAMPORTS_PER_SOL} SOL < 2 — airdrop or fund before retry`);
  }

  const mintLen = getMintLen(EXTENSIONS);
  const rentLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const initTx = new Transaction().add(...buildInitInstructions(mint, bootstrap.publicKey, mintLen, rentLamports));
  const initSig = await sendAndConfirmTransaction(connection, initTx, [bootstrap, mintKp], { commitment: 'confirmed' });

  const metadataTx = new Transaction().add(buildMetadataInstruction(mint, bootstrap.publicKey));
  const metadataSig = await sendAndConfirmTransaction(connection, metadataTx, [bootstrap], { commitment: 'confirmed' });

  const handoverTx = new Transaction().add(
    ...buildHandoverInstructions(mint, bootstrap.publicKey, devnetHandoverTargets(bootstrap.publicKey)),
  );
  const handoverSig = await sendAndConfirmTransaction(connection, handoverTx, [bootstrap], { commitment: 'confirmed' });

  const slot = await connection.getSlot('confirmed');

  writeStateFile('devnet', {
    network: 'devnet',
    mintPubkey: mint.toBase58(),
    bootstrapPubkey: bootstrap.publicKey.toBase58(),
    initTxSig: initSig,
    metadataTxSig: metadataSig,
    handoverTxSig: handoverSig,
    slot,
    configHash: configHash(),
    timestamp: new Date().toISOString(),
  });

  console.log(`[ok] devnet mint ${mint.toBase58()} — init ${initSig} metadata ${metadataSig} handover ${handoverSig}`);
}

function refuseMainnet(opts: { confirmMainnet: boolean }): never {
  const devnetState = readStateFile('devnet');
  const preconditions = {
    autonomyStopList: 'AUTONOMY.md forbids on-chain actions against mainnet in autonomous mode',
    confirmFlagPresent: opts.confirmMainnet,
    devnetRehearsalPresent: !!devnetState,
    devnetRehearsalWithin7d: devnetState
      ? Date.now() - Date.parse(devnetState.timestamp) < 7 * 24 * 60 * 60 * 1000
      : false,
    configHashMatchesDevnet: devnetState ? devnetState.configHash === configHash() : false,
    councilAttestedConfig: false,
    ceremonyRunbookAcknowledged: false,
  };
  console.error('[refused] mainnet mode is not executable from this script path');
  console.error(JSON.stringify(preconditions, null, 2));
  console.error('\nMainnet init is a 6-of-9 Squads ceremony per specs/token2022-saep-mint.md §Multisig ceremony.');
  console.error('The runbook is in the spec, not this script. Human signers + air-gapped bootstrap key + council-attested config.');
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.mode === 'mainnet') refuseMainnet({ confirmMainnet: args.confirmMainnet });
  if (args.mode === 'devnet') {
    await runDevnet({ keypairPath: args.keypairPath, rpcUrl: args.rpcUrl, forceReinit: args.forceReinit });
    return;
  }
  await runDryRun();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
