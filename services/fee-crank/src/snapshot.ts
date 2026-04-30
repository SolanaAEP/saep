import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Keypair, PublicKey, Transaction, Connection } from '@solana/web3.js';
import type { Program } from '@coral-xyz/anchor';
import type pg from 'pg';
import type { Logger } from 'pino';
import {
  resolveCluster,
  nxsStakingProgram,
  stakingPoolPda,
  buildSnapshotEpochIx,
  buildCommitDistributionRootIx,
  MerkleTree,
  governanceLeaf,
  feeClaimLeaf,
  toHex,
} from '@saep/sdk';

import { saveSnapshot } from './db.js';
import { snapshotTotal } from './metrics.js';

type StakingProgram = ReturnType<typeof nxsStakingProgram>;

interface StakerEntry {
  owner: PublicKey;
  votingPower: bigint;
  amount: bigint;
}

async function fetchActiveStakers(program: StakingProgram): Promise<StakerEntry[]> {
  const [pool] = stakingPoolPda(program.programId);
  const accounts = await program.account.stakeAccount.all([
    { memcmp: { offset: 8 + 32, bytes: pool.toBase58() } },
  ]);

  return accounts
    .filter((a) => {
      const statusKey = Object.keys(a.account.status)[0];
      return statusKey === 'active' && BigInt(a.account.amount.toString()) > 0n;
    })
    .map((a) => ({
      owner: a.account.owner,
      votingPower: BigInt(a.account.votingPower.toString()),
      amount: BigInt(a.account.amount.toString()),
    }));
}

function computeFeeShares(
  stakers: StakerEntry[],
  totalVotingPower: bigint,
  stakerPoolAmount: bigint,
): { wallet: PublicKey; share: bigint }[] {
  if (totalVotingPower === 0n || stakers.length === 0) return [];

  const shares = stakers.map((s) => ({
    wallet: s.owner,
    share: (s.votingPower * stakerPoolAmount) / totalVotingPower,
  }));

  const distributed = shares.reduce((sum, s) => sum + s.share, 0n);
  const dust = stakerPoolAmount - distributed;
  if (dust > 0n && shares.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < shares.length; i++) {
      if (shares[i]!.share > shares[maxIdx]!.share) maxIdx = i;
    }
    shares[maxIdx]!.share += dust;
  }

  return shares;
}

export interface SnapshotDeps {
  rpcUrl: string;
  cluster: string;
  stakingProgramId: string;
  cranker: Keypair;
  db: pg.Pool;
  log: Logger;
}

export async function processEpochSnapshot(
  deps: SnapshotDeps,
  feeProgram: Program,
  epochId: bigint,
  stakerPoolAmount: bigint,
): Promise<void> {
  const { cranker, db, log } = deps;

  const connection = new Connection(deps.rpcUrl, 'confirmed');
  const wallet = new Wallet(cranker);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  const clusterCfg = resolveCluster({
    cluster: deps.cluster as 'devnet' | 'mainnet-beta' | 'localnet',
    endpoint: deps.rpcUrl,
    programIds: { nxsStaking: deps.stakingProgramId },
  });
  const stakingProgram = nxsStakingProgram(provider, clusterCfg);

  const stakers = await fetchActiveStakers(stakingProgram);
  if (stakers.length === 0) {
    log.info('no active stakers, skipping snapshot');
    snapshotTotal.inc({ outcome: 'skipped' });
    return;
  }

  const totalVotingPower = stakers.reduce((sum, s) => sum + s.votingPower, 0n);
  log.info({ stakers: stakers.length, totalVotingPower: totalVotingPower.toString() }, 'building merkle trees');

  const govLeaves = stakers.map((s) => governanceLeaf(s.owner, s.votingPower));
  const govTree = new MerkleTree(govLeaves);

  const feeShares = computeFeeShares(stakers, totalVotingPower, stakerPoolAmount);
  const feeLeaves = feeShares.map((s) => feeClaimLeaf(s.wallet, s.share, epochId));
  const feeTree = new MerkleTree(feeLeaves);

  const slot = BigInt(await connection.getSlot());

  try {
    const [pool] = stakingPoolPda(stakingProgram.programId);
    const poolData = await stakingProgram.account.stakingPool.fetch(pool);
    const currentEpoch = BigInt(poolData.currentEpoch.toString());

    const snapshotIx = await buildSnapshotEpochIx(stakingProgram, {
      authority: cranker.publicKey,
      totalVotingPower,
      stakerCount: stakers.length,
      currentEpoch,
    });
    const tx1 = new Transaction().add(snapshotIx);
    await provider.sendAndConfirm!(tx1, [cranker]);
    log.info({ epoch: currentEpoch.toString() }, 'staking snapshot committed on-chain');
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'staking snapshot tx failed (may already exist)');
  }

  try {
    const commitIx = await buildCommitDistributionRootIx(feeProgram as never, {
      committer: cranker.publicKey,
      epochId,
      root: feeTree.root,
      leafCount: feeShares.length,
      totalWeight: totalVotingPower,
    });
    const tx2 = new Transaction().add(commitIx);
    await provider.sendAndConfirm!(tx2, [cranker]);
    log.info({ epochId: epochId.toString() }, 'distribution root committed on-chain');
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'distribution root commit failed (may already exist)');
  }

  await saveSnapshot(db, {
    epochId,
    governanceRoot: govTree.root,
    feeRoot: feeTree.root,
    totalVotingPower,
    stakerCount: stakers.length,
    snapshotSlot: slot,
    governanceLeaves: stakers.map((s) => ({
      wallet: s.owner.toBase58(),
      weight: s.votingPower.toString(),
    })),
    feeLeaves: feeShares.map((s) => ({
      wallet: s.wallet.toBase58(),
      amount: s.share.toString(),
      epochId: epochId.toString(),
    })),
  });

  snapshotTotal.inc({ outcome: 'success' });
  log.info(
    {
      epochId: epochId.toString(),
      stakers: stakers.length,
      govRoot: toHex(govTree.root),
      feeRoot: toHex(feeTree.root),
    },
    'epoch snapshot complete',
  );
}
