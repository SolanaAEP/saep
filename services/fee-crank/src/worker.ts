import { readFileSync } from 'node:fs';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import type { Logger } from 'pino';
import type pg from 'pg';
import {
  resolveCluster,
  feeCollectorProgram,
  feeConfigPda,
  epochPda,
  buildHarvestTransferFeesIx,
  buildHarvestConfidentialFeesIx,
  buildProcessEpochIx,
  buildExecuteBurnIx,
} from '@saep/sdk';
import { processEpochSnapshot } from './snapshot.js';

type FeeCollectorProgram = ReturnType<typeof feeCollectorProgram>;
import type { Config } from './config.js';
import {
  currentEpochId as currentEpochIdGauge,
  epochStatus as epochStatusGauge,
  harvestTotal,
  processEpochTotal,
  executeBurnTotal,
  tickDuration,
  tickFailuresTotal,
  tickSkippedTotal,
} from './metrics.js';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const EPOCH_STATUS_OPEN = 0;
const EPOCH_STATUS_SPLITTING = 1;

interface EpochState {
  epochId: bigint;
  status: number;
  totalCollected: bigint;
  stakerAmount: bigint;
  burnExecuted: boolean;
  distributionCommitted: boolean;
  startedAtTs: bigint;
  closedAtTs: bigint | null;
}

export interface WorkerDeps {
  config: Config;
  log: Logger;
  db: pg.Pool | null;
}

export interface Worker {
  start: () => void;
  stop: () => Promise<void>;
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function makeProgram(
  config: Config,
  keypair: Keypair,
): { program: FeeCollectorProgram; connection: Connection } {
  const clusterCfg = resolveCluster({
    cluster: config.cluster as 'devnet' | 'mainnet-beta' | 'localnet',
    endpoint: config.rpcUrl,
    programIds: { feeCollector: config.feeCollectorProgramId },
  });
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = feeCollectorProgram(provider, clusterCfg);
  return { program, connection };
}

async function fetchConfig(program: FeeCollectorProgram) {
  const [configPda] = feeConfigPda(program.programId);
  return program.account.feeCollectorConfig.fetch(configPda);
}

async function fetchEpoch(
  program: FeeCollectorProgram,
  epochId: bigint,
): Promise<EpochState | null> {
  const [pda] = epochPda(program.programId, epochId);
  try {
    const raw = await program.account.epochAccount.fetch(pda);
    const statusKey = Object.keys(raw.status)[0]!;
    const statusMap: Record<string, number> = {
      open: 0,
      splitting: 1,
      distributionCommitted: 2,
      stale: 3,
    };
    return {
      epochId: BigInt(raw.epochId.toString()),
      status: statusMap[statusKey] ?? -1,
      totalCollected: BigInt(raw.totalCollected.toString()),
      stakerAmount: BigInt(raw.stakerAmount.toString()),
      burnExecuted: raw.burnExecuted,
      distributionCommitted: raw.stakerDistributionCommitted,
      startedAtTs: BigInt(raw.startedAtTs.toString()),
      closedAtTs: raw.closedAtTs ? BigInt(raw.closedAtTs.toString()) : null,
    };
  } catch {
    return null;
  }
}

async function findHolderAccounts(
  connection: Connection,
  saepMint: PublicKey,
  max: number,
): Promise<PublicKey[]> {
  // T22 accounts have variable size due to extensions, so filter by mint only
  const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: saepMint.toBase58() } },
    ],
    dataSlice: { offset: 0, length: 0 },
  });
  return accounts.slice(0, max).map((a) => a.pubkey);
}

async function tryHarvest(
  program: FeeCollectorProgram,
  connection: Connection,
  cranker: Keypair,
  saepMint: PublicKey,
  epochId: bigint,
  ctEnabled: boolean,
  maxAccounts: number,
  log: Logger,
) {
  const holders = await findHolderAccounts(connection, saepMint, maxAccounts);
  if (holders.length === 0) {
    log.debug('no holder accounts to harvest');
    return;
  }

  const remaining = holders.map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));

  try {
    const ix = await buildHarvestTransferFeesIx(program, {
      cranker: cranker.publicKey,
      saepMint,
      currentEpochId: epochId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      remainingAccounts: remaining,
    });
    const tx = new Transaction().add(ix);
    await (program.provider as AnchorProvider).sendAndConfirm!(tx, [cranker]);
    harvestTotal.inc({ type: 'transfer_fee', outcome: 'success' });
    log.info({ holders: holders.length }, 'harvested transfer fees');
  } catch (err) {
    harvestTotal.inc({ type: 'transfer_fee', outcome: 'error' });
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'harvest transfer fees failed');
  }

  if (ctEnabled) {
    try {
      const ix = await buildHarvestConfidentialFeesIx(program, {
        cranker: cranker.publicKey,
        saepMint,
        currentEpochId: epochId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        remainingAccounts: remaining,
      });
      const tx = new Transaction().add(ix);
      await (program.provider as AnchorProvider).sendAndConfirm!(tx, [cranker]);
      harvestTotal.inc({ type: 'confidential', outcome: 'success' });
      log.info({ holders: holders.length }, 'harvested confidential fees');
    } catch (err) {
      harvestTotal.inc({ type: 'confidential', outcome: 'error' });
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'harvest confidential fees failed');
    }
  }
}

async function tryProcessEpoch(
  program: FeeCollectorProgram,
  cranker: Keypair,
  config: Awaited<ReturnType<typeof fetchConfig>>,
  epochId: bigint,
  log: Logger,
) {
  const saepMint = config.saepMint;
  const nextEpochId = epochId + 1n;

  try {
    const ix = await buildProcessEpochIx(program, {
      cranker: cranker.publicKey,
      saepMint,
      grantRecipient: config.grantRecipient,
      treasuryRecipient: config.treasuryRecipient,
      currentEpochId: epochId,
      nextEpochId,
      snapshotId: epochId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    const tx = new Transaction().add(ix);
    await (program.provider as AnchorProvider).sendAndConfirm!(tx, [cranker]);
    processEpochTotal.inc({ outcome: 'success' });
    log.info({ epochId: epochId.toString(), nextEpochId: nextEpochId.toString() }, 'processed epoch');
  } catch (err) {
    processEpochTotal.inc({ outcome: 'error' });
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'process epoch failed');
  }
}

async function tryExecuteBurn(
  program: FeeCollectorProgram,
  cranker: Keypair,
  saepMint: PublicKey,
  epochId: bigint,
  log: Logger,
) {
  try {
    const ix = await buildExecuteBurnIx(program, {
      cranker: cranker.publicKey,
      saepMint,
      epochId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    const tx = new Transaction().add(ix);
    await (program.provider as AnchorProvider).sendAndConfirm!(tx, [cranker]);
    executeBurnTotal.inc({ outcome: 'success' });
    log.info({ epochId: epochId.toString() }, 'executed burn');
  } catch (err) {
    executeBurnTotal.inc({ outcome: 'error' });
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'execute burn failed');
  }
}

export async function runTick(deps: WorkerDeps, program: FeeCollectorProgram, connection: Connection, cranker: Keypair): Promise<void> {
  const { config, log } = deps;
  const stop = tickDuration.startTimer();

  try {
    const feeConfig = await fetchConfig(program);
    if (feeConfig.paused) {
      tickSkippedTotal.inc({ reason: 'paused' });
      log.info('protocol paused, skipping');
      return;
    }

    const saepMint = feeConfig.saepMint;
    const nextId = BigInt(feeConfig.nextEpochId.toString());
    const currentId = nextId > 0n ? nextId - 1n : 0n;
    currentEpochIdGauge.set(Number(currentId));

    const epoch = await fetchEpoch(program, currentId);
    if (!epoch) {
      tickSkippedTotal.inc({ reason: 'no_epoch' });
      log.warn({ epochId: currentId.toString() }, 'epoch account not found');
      return;
    }

    epochStatusGauge.set(epoch.status);
    log.info(
      { epochId: currentId.toString(), status: epoch.status, totalCollected: epoch.totalCollected.toString() },
      'tick:epoch-state',
    );

    if (epoch.status === EPOCH_STATUS_OPEN) {
      await tryHarvest(
        program, connection, cranker, saepMint, currentId,
        feeConfig.confidentialTransfersEnabled, config.maxHarvestAccounts, log,
      );

      const now = BigInt(Math.floor(Date.now() / 1000));
      const epochEnd = epoch.startedAtTs + BigInt(feeConfig.epochDurationSecs.toString());
      if (now >= epochEnd) {
        log.info('epoch duration elapsed, processing');
        await tryProcessEpoch(program, cranker, feeConfig, currentId, log);
      }
    } else if (epoch.status === EPOCH_STATUS_SPLITTING && !epoch.burnExecuted) {
      await tryExecuteBurn(program, cranker, saepMint, currentId, log);
    } else if (epoch.status === EPOCH_STATUS_SPLITTING && epoch.burnExecuted && !epoch.distributionCommitted && deps.db) {
      log.info({ epochId: currentId.toString() }, 'burn done, running epoch snapshot');
      try {
        await processEpochSnapshot(
          {
            rpcUrl: config.rpcUrl,
            cluster: config.cluster,
            stakingProgramId: config.stakingProgramId,
            cranker,
            db: deps.db,
            log,
          },
          program as never,
          currentId,
          epoch.stakerAmount,
        );
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'snapshot failed');
      }
    } else {
      tickSkippedTotal.inc({ reason: 'epoch_not_actionable' });
      log.debug({ status: epoch.status, burnExecuted: epoch.burnExecuted }, 'nothing to do');
    }
  } catch (err) {
    tickFailuresTotal.inc({ stage: 'tick' });
    throw err;
  } finally {
    stop();
  }
}

export function startWorker(deps: WorkerDeps): Worker {
  const cranker = loadKeypair(deps.config.operatorKeypairPath);
  const { program, connection } = makeProgram(deps.config, cranker);
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runTick(deps, program, connection, cranker);
    } catch (err) {
      deps.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'tick:failed',
      );
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), deps.config.pollIntervalMs);
      void tick();
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
