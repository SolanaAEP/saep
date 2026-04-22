'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  buildBeginUnstakeIx,
  buildStakeIx,
  buildStakeWithdrawIx,
  makeProvider,
  nxsStakingProgram,
  stakeAccountPda,
  stakeVaultPda,
  stakingPoolPda,
} from '@saep/sdk';
import { useCluster, useSendTransaction } from '@saep/sdk-ui';

const READONLY_WALLET = {
  publicKey: new PublicKey('11111111111111111111111111111111'),
  signTransaction: async <T,>(tx: T) => tx,
  signAllTransactions: async <T,>(txs: T[]) => txs,
};

const DAY = 24 * 60 * 60;
const COOLDOWN_SECS = 3 * DAY;
const MIN_LOCKUP_SECS = 7 * DAY;
const MAX_LOCKUP_SECS = 365 * DAY;
const MAX_MULTIPLIER = 4;
const CONFIG_SEED = Buffer.from('staking_config');
const LOCK_PRESETS = [7, 30, 90, 180, 365] as const;
const MAINNET_SAEP_MINT = 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump';

interface ConfigView {
  authority: PublicKey;
  bump: number;
}

interface PoolView {
  authority: PublicKey;
  pendingAuthority: PublicKey | null;
  stakeMint: PublicKey;
  totalStaked: bigint;
  totalStakers: number;
  currentEpoch: bigint;
  epochDurationSecs: number;
  epochStartTime: number;
  rewardRatePerEpoch: bigint;
  paused: boolean;
  bump: number;
}

interface StakePositionView {
  owner: PublicKey;
  pool: PublicKey;
  amount: bigint;
  lockupEnd: number;
  lockupMultiplier: number;
  votingPower: bigint;
  stakedAt: number;
  cooldownStart: number;
  pendingRewards: bigint;
  lastClaimEpoch: bigint;
  status: 'active' | 'cooldown' | 'withdrawn' | 'unknown';
  bump: number;
  vaultBump: number;
}

interface MintView {
  address: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  supply: bigint;
  mintAuthority: PublicKey | null;
}

interface WalletStakeBalance {
  ata: PublicKey;
  exists: boolean;
  amount: bigint;
}

export function StakingShell() {
  const cluster = useCluster();
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [amountInput, setAmountInput] = useState('');
  const [lockDays, setLockDays] = useState<number>(30);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const now = useNow();

  const program = useMemo(() => {
    return nxsStakingProgram(
      makeProvider({
        connection,
        wallet: READONLY_WALLET,
      }),
      cluster,
    );
  }, [connection, cluster]);

  const [configPda] = useMemo(
    () => PublicKey.findProgramAddressSync([CONFIG_SEED], program.programId),
    [program.programId],
  );
  const [poolPda] = useMemo(() => stakingPoolPda(program.programId), [program.programId]);
  const stakePda = useMemo(() => {
    if (!publicKey) return null;
    return stakeAccountPda(program.programId, poolPda, publicKey)[0];
  }, [program.programId, poolPda, publicKey]);
  const stakeVault = useMemo(() => {
    if (!stakePda) return null;
    return stakeVaultPda(program.programId, stakePda)[0];
  }, [program.programId, stakePda]);

  const programInfo = useQuery({
    queryKey: ['nxs-staking-program', cluster.cluster, program.programId.toBase58()],
    staleTime: 60_000,
    queryFn: () => connection.getAccountInfo(program.programId, 'confirmed'),
  });

  const configQuery = useQuery({
    queryKey: ['nxs-staking-config', cluster.cluster, configPda.toBase58()],
    enabled: Boolean(programInfo.data?.executable),
    staleTime: 30_000,
    queryFn: async (): Promise<ConfigView | null> => {
      const raw = await fetchNullableAccount(program, 'stakingConfig', configPda);
      return raw ? mapConfig(raw) : null;
    },
  });

  const poolQuery = useQuery({
    queryKey: ['nxs-staking-pool', cluster.cluster, poolPda.toBase58()],
    enabled: Boolean(programInfo.data?.executable),
    staleTime: 15_000,
    queryFn: async (): Promise<PoolView | null> => {
      const raw = await fetchNullableAccount(program, 'stakingPool', poolPda);
      return raw ? mapPool(raw) : null;
    },
  });

  const mintQuery = useQuery({
    queryKey: ['nxs-staking-mint', cluster.cluster, poolQuery.data?.stakeMint.toBase58() ?? null],
    enabled: Boolean(poolQuery.data?.stakeMint),
    staleTime: 30_000,
    queryFn: async (): Promise<MintView> => {
      const address = poolQuery.data!.stakeMint;
      const info = await connection.getAccountInfo(address, 'confirmed');
      if (!info) throw new Error('Stake mint account not found');
      const tokenProgram = info.owner;
      const mint = await getMint(connection, address, 'confirmed', tokenProgram);
      return {
        address,
        tokenProgram,
        decimals: mint.decimals,
        supply: mint.supply,
        mintAuthority: mint.mintAuthority,
      };
    },
  });

  const positionQuery = useQuery({
    queryKey: ['nxs-staking-position', cluster.cluster, stakePda?.toBase58() ?? null],
    enabled: Boolean(stakePda),
    staleTime: 10_000,
    queryFn: async (): Promise<StakePositionView | null> => {
      const raw = await fetchNullableAccount(program, 'stakeAccount', stakePda!);
      return raw ? mapStakePosition(raw) : null;
    },
  });

  const walletBalanceQuery = useQuery({
    queryKey: [
      'nxs-staking-wallet-balance',
      cluster.cluster,
      publicKey?.toBase58() ?? null,
      mintQuery.data?.address.toBase58() ?? null,
    ],
    enabled: Boolean(publicKey && mintQuery.data),
    staleTime: 10_000,
    queryFn: async (): Promise<WalletStakeBalance> => {
      const ata = getAssociatedTokenAddressSync(
        mintQuery.data!.address,
        publicKey!,
        false,
        mintQuery.data!.tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const info = await connection.getAccountInfo(ata, 'confirmed');
      if (!info) return { ata, exists: false, amount: 0n };
      const balance = await connection.getTokenAccountBalance(ata, 'confirmed');
      return {
        ata,
        exists: true,
        amount: BigInt(balance.value.amount),
      };
    },
  });

  const stakePreviewAmount = useMemo(() => {
    if (!mintQuery.data) return null;
    return parseTokenAmount(amountInput, mintQuery.data.decimals);
  }, [amountInput, mintQuery.data]);

  const lockupSecs = lockDays * DAY;
  const previewMultiplier = computeLockMultiplier(lockupSecs);
  const previewVotingPower =
    stakePreviewAmount != null ? stakePreviewAmount * BigInt(previewMultiplier) : null;
  const rewardsLive = (poolQuery.data?.rewardRatePerEpoch ?? 0n) > 0n;
  const assetLabel = mintQuery.data ? stakeAssetLabel(mintQuery.data.address) : 'stake token';
  const availableToStake =
    walletBalanceQuery.data && mintQuery.data
      ? `${formatTokenAmount(walletBalanceQuery.data.amount, mintQuery.data.decimals, 4)} ${assetLabel}`
      : walletBalanceQuery.data?.exists === false
        ? `0 ${assetLabel}`
        : connected
          ? 'Loading balance…'
          : 'Connect wallet';
  const availableToStakeDetail = !connected
    ? 'Connect a Solana wallet to read your stake balance'
    : walletBalanceQuery.data?.exists === false
      ? 'Create the token account, then fund it before staking'
      : mintQuery.data && walletBalanceQuery.data
        ? `Wallet ATA ${truncate(walletBalanceQuery.data.ata.toBase58())}`
        : 'Reading wallet state';
  const maxStakeAmount =
    walletBalanceQuery.data && mintQuery.data
      ? formatTokenAmount(walletBalanceQuery.data.amount, mintQuery.data.decimals, mintQuery.data.decimals)
      : null;
  const walletStatusLabel = !connected
    ? 'Not connected'
    : walletBalanceQuery.data?.exists === false
      ? 'Token account missing'
      : 'Ready';

  const explorerBase = useMemo(() => explorerClusterSuffix(cluster.cluster), [cluster.cluster]);

  const createAtaMutation = useSendTransaction<{ ata: PublicKey; mint: PublicKey; owner: PublicKey; tokenProgram: PublicKey }>(
    {
      buildInstruction: async (input): Promise<TransactionInstruction> =>
        createAssociatedTokenAccountIdempotentInstruction(
          input.owner,
          input.ata,
          input.owner,
          input.mint,
          input.tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      invalidateKeys: [
        [
          'nxs-staking-wallet-balance',
          cluster.cluster,
          publicKey?.toBase58() ?? null,
          mintQuery.data?.address.toBase58() ?? null,
        ],
      ],
    },
    {
      onSuccess: (result) => setLastAction(`Created stake token account: ${result.signature}`),
    },
  );

  const stakeMutation = useSendTransaction<{
    owner: PublicKey;
    stakeMint: PublicKey;
    ownerTokenAccount: PublicKey;
    amount: bigint;
    lockupDurationSecs: bigint;
    tokenProgram: PublicKey;
  }>(
    {
      buildInstruction: async (input) =>
        buildStakeIx(program, {
          owner: input.owner,
          stakeMint: input.stakeMint,
          ownerTokenAccount: input.ownerTokenAccount,
          amount: input.amount,
          lockupDurationSecs: input.lockupDurationSecs,
          tokenProgram: input.tokenProgram,
        }),
      invalidateKeys: [
        ['nxs-staking-pool', cluster.cluster, poolPda.toBase58()],
        ['nxs-staking-position', cluster.cluster, stakePda?.toBase58() ?? null],
        [
          'nxs-staking-wallet-balance',
          cluster.cluster,
          publicKey?.toBase58() ?? null,
          mintQuery.data?.address.toBase58() ?? null,
        ],
      ],
      priorityFee: 'auto',
    },
    {
      onSuccess: (result) => setLastAction(`Staked successfully: ${result.signature}`),
    },
  );

  const beginUnstakeMutation = useSendTransaction<{ owner: PublicKey }>(
    {
      buildInstruction: async (input) => buildBeginUnstakeIx(program, input),
      invalidateKeys: [
        ['nxs-staking-pool', cluster.cluster, poolPda.toBase58()],
        ['nxs-staking-position', cluster.cluster, stakePda?.toBase58() ?? null],
      ],
      priorityFee: 'auto',
    },
    {
      onSuccess: (result) => setLastAction(`Cooldown started: ${result.signature}`),
    },
  );

  const withdrawMutation = useSendTransaction<{
    owner: PublicKey;
    stakeMint: PublicKey;
    ownerTokenAccount: PublicKey;
    tokenProgram: PublicKey;
  }>(
    {
      buildInstruction: async (input) =>
        buildStakeWithdrawIx(program, {
          owner: input.owner,
          stakeMint: input.stakeMint,
          ownerTokenAccount: input.ownerTokenAccount,
          tokenProgram: input.tokenProgram,
        }),
      invalidateKeys: [
        ['nxs-staking-pool', cluster.cluster, poolPda.toBase58()],
        ['nxs-staking-position', cluster.cluster, stakePda?.toBase58() ?? null],
        [
          'nxs-staking-wallet-balance',
          cluster.cluster,
          publicKey?.toBase58() ?? null,
          mintQuery.data?.address.toBase58() ?? null,
        ],
      ],
      priorityFee: 'auto',
    },
    {
      onSuccess: (result) => setLastAction(`Stake withdrawn: ${result.signature}`),
    },
  );

  const position = positionQuery.data;
  const cooldownEnd =
    position && position.status === 'cooldown' ? position.cooldownStart + COOLDOWN_SECS : null;
  const canBeginUnstake =
    position?.status === 'active' && now >= position.lockupEnd && !beginUnstakeMutation.isPending;
  const canWithdraw =
    position?.status === 'cooldown' &&
    cooldownEnd != null &&
    now >= cooldownEnd &&
    !withdrawMutation.isPending;
  const canCreateAta =
    connected &&
    publicKey != null &&
    mintQuery.data != null &&
    walletBalanceQuery.data?.exists === false &&
    !createAtaMutation.isPending;
  const canStake =
    connected &&
    publicKey != null &&
    poolQuery.data != null &&
    mintQuery.data != null &&
    walletBalanceQuery.data?.exists === true &&
    position == null &&
    stakePreviewAmount != null &&
    stakePreviewAmount > 0n &&
    stakePreviewAmount <= walletBalanceQuery.data.amount &&
    lockupSecs >= MIN_LOCKUP_SECS &&
    lockupSecs <= MAX_LOCKUP_SECS &&
    !stakeMutation.isPending;

  return (
    <section className="flex max-w-6xl flex-col gap-8" data-testid="staking-shell">
      <header className="flex flex-col gap-5 border-b border-ink/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-1 font-mono text-[10px] text-mute tracking-widest uppercase">
            08 // staking
          </div>
          <h1 className="font-display text-2xl tracking-tight">Stake SAEP</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink/65">
            Lock SAEP to establish operator weight and future governance eligibility. This page
            reads live mainnet staking state directly from the deployed `nxs_staking` program.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WalletMultiButton />
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          eyebrow="Available to stake"
          value={availableToStake}
          detail={availableToStakeDetail}
          testId="staking-available-balance"
        />
        <MetricCard
          eyebrow="Your position"
          value={
            position && mintQuery.data
              ? `${formatTokenAmount(position.amount, mintQuery.data.decimals, 4)} ${assetLabel}`
              : 'No active stake'
          }
          detail={
            position
              ? statusHeadline(position.status, now, position.lockupEnd, cooldownEnd)
              : 'Open a first position from the connected wallet'
          }
          testId="staking-position-card"
        />
        <MetricCard
          eyebrow="Total staked"
          value={
            poolQuery.data && mintQuery.data
              ? `${formatTokenAmount(poolQuery.data.totalStaked, mintQuery.data.decimals, 4)} ${assetLabel}`
              : '—'
          }
          detail={poolQuery.data ? `${poolQuery.data.totalStakers} live stakers` : 'Pool awaiting initialization'}
          testId="staking-total-staked-card"
        />
        <MetricCard
          eyebrow="Lock window"
          value={`${formatDuration(MIN_LOCKUP_SECS)} → ${formatDuration(MAX_LOCKUP_SECS)}`}
          detail="Cooldown unlock begins after the lock expires"
          testId="staking-lock-window-card"
        />
      </div>

      {(programInfo.error || configQuery.error || poolQuery.error || mintQuery.error || positionQuery.error || walletBalanceQuery.error) && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {[
            programInfo.error,
            configQuery.error,
            poolQuery.error,
            mintQuery.error,
            positionQuery.error,
            walletBalanceQuery.error,
          ]
            .filter(Boolean)
            .map((error) => (error as Error).message)
            .join(' · ')}
        </div>
      )}

      {lastAction ? (
        <div className="border border-lime/30 bg-lime/5 px-4 py-3 text-sm text-ink/80">
          {lastAction}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="flex flex-col gap-6">
          <Panel title="Open a position" subtitle="Lock SAEP directly from the connected wallet.">
            {!connected ? (
              <div className="mb-6 border border-dashed border-ink/15 px-5 py-5 text-sm text-ink/65">
                Connect a Solana wallet to see your available SAEP balance, create a token account,
                and submit a stake transaction.
              </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <div className="grid gap-3 border-b border-ink/10 pb-5 sm:grid-cols-2">
                  <FactBlock label="Connected wallet" value={publicKey ? truncate(publicKey.toBase58()) : 'Awaiting wallet'} mono />
                  <FactBlock label="Wallet status" value={walletStatusLabel} />
                  <FactBlock label="Stake token account" value={walletBalanceQuery.data?.exists ? 'Ready' : connected ? 'Missing' : 'Awaiting wallet'} />
                  <FactBlock label="Pool asset" value={mintQuery.data ? assetLabel : 'Awaiting pool init'} />
                </div>

                {canCreateAta ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!publicKey || !walletBalanceQuery.data || !mintQuery.data) return;
                      createAtaMutation.mutate({
                        ata: walletBalanceQuery.data.ata,
                        mint: mintQuery.data.address,
                        owner: publicKey,
                        tokenProgram: mintQuery.data.tokenProgram,
                      });
                    }}
                    className="mt-5 inline-flex h-11 items-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink transition-colors hover:border-ink/35 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {createAtaMutation.isPending ? 'Creating token account…' : 'Create stake token account'}
                  </button>
                ) : null}

                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="staking-amount"
                      className="font-mono text-[10px] uppercase tracking-widest text-mute"
                    >
                      Amount
                    </label>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                      Available: <span className="text-ink">{availableToStake}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="staking-amount"
                      type="text"
                      inputMode="decimal"
                      value={amountInput}
                      onChange={(event) => setAmountInput(event.target.value)}
                      placeholder={mintQuery.data ? `0.0 ${assetLabel}` : '0.0'}
                      className="h-12 flex-1 border border-ink/15 bg-paper-2 px-4 font-mono text-base text-ink placeholder:text-mute focus:border-ink/35 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!maxStakeAmount}
                      onClick={() => maxStakeAmount && setAmountInput(maxStakeAmount)}
                      className="inline-flex h-12 items-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink transition-colors hover:border-ink/35 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Max
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                      Lock duration
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-ink">
                      {lockDays} days // {previewMultiplier}x weight
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {LOCK_PRESETS.map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setLockDays(days)}
                        className={`inline-flex h-10 items-center border px-4 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                          lockDays === days
                            ? 'border-ink bg-ink text-paper'
                            : 'border-ink/15 text-ink/70 hover:border-ink/35 hover:text-ink'
                        }`}
                      >
                        {days}d
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={7}
                    max={365}
                    step={1}
                    value={lockDays}
                    onChange={(event) => setLockDays(Number(event.target.value))}
                    className="mt-4 w-full accent-lime"
                  />
                </div>

                <div className="mt-6 border-t border-ink/10 pt-5">
                  <button
                    type="button"
                    disabled={!canStake || !publicKey || !mintQuery.data || !walletBalanceQuery.data || stakePreviewAmount == null}
                    onClick={() =>
                      publicKey &&
                      mintQuery.data &&
                      walletBalanceQuery.data &&
                      stakePreviewAmount != null &&
                      stakeMutation.mutate({
                        owner: publicKey,
                        stakeMint: mintQuery.data.address,
                        ownerTokenAccount: walletBalanceQuery.data.ata,
                        amount: stakePreviewAmount,
                        lockupDurationSecs: BigInt(lockupSecs),
                        tokenProgram: mintQuery.data.tokenProgram,
                      })
                    }
                    className="inline-flex h-12 items-center bg-ink px-5 font-mono text-[11px] uppercase tracking-[0.08em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {stakeMutation.isPending ? 'Submitting stake…' : 'Stake tokens'}
                  </button>
                  <p className="mt-3 max-w-2xl text-xs text-ink/55">
                    One position per wallet, lockups between {formatDuration(MIN_LOCKUP_SECS)} and{' '}
                    {formatDuration(MAX_LOCKUP_SECS)}, and a 3-day cooldown before withdrawal.
                  </p>
                </div>
              </div>

              <div className="border-t border-ink/10 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
                  Preview
                </div>
                <div className="mt-4 border border-ink/10">
                  <PreviewRow
                    label="Stake amount"
                    value={
                      stakePreviewAmount != null && mintQuery.data
                        ? `${formatTokenAmount(stakePreviewAmount, mintQuery.data.decimals, 4)} ${assetLabel}`
                        : 'Enter an amount'
                    }
                  />
                  <PreviewRow
                    label="Voting power"
                    value={
                      previewVotingPower != null && mintQuery.data
                        ? `${formatTokenAmount(previewVotingPower, mintQuery.data.decimals, 4)} ${assetLabel}`
                        : '—'
                    }
                  />
                  <PreviewRow label="Lock ends" value={formatTimestamp(now + lockupSecs)} />
                  <PreviewRow label="Cooldown unlock" value={formatTimestamp(now + lockupSecs + COOLDOWN_SECS)} />
                  <PreviewRow
                    label="Wallet sufficiency"
                    value={
                      walletBalanceQuery.data && mintQuery.data
                        ? walletBalanceQuery.data.amount >= (stakePreviewAmount ?? 0n)
                          ? 'Sufficient balance'
                          : 'Insufficient balance'
                        : 'Awaiting wallet state'
                    }
                  />
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Your position" subtitle="Lifecycle and actions for the connected wallet.">
            {position && mintQuery.data ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FactBlock label="Staked amount" value={`${formatTokenAmount(position.amount, mintQuery.data.decimals, 4)} ${assetLabel}`} />
                  <FactBlock label="Voting power" value={`${formatTokenAmount(position.votingPower, mintQuery.data.decimals, 4)} ${assetLabel}`} />
                  <FactBlock label="Multiplier" value={`${position.lockupMultiplier}x`} />
                  <FactBlock label="Status" value={statusHeadline(position.status, now, position.lockupEnd, cooldownEnd)} />
                  <FactBlock label="Lockup ends" value={formatTimestamp(position.lockupEnd)} />
                  <FactBlock label="Stake vault" value={stakeVault ? truncate(stakeVault.toBase58()) : '—'} mono />
                </div>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={!canBeginUnstake || !publicKey}
                    onClick={() => publicKey && beginUnstakeMutation.mutate({ owner: publicKey })}
                    className="inline-flex h-11 items-center justify-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink transition-colors hover:border-ink/35 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {beginUnstakeMutation.isPending ? 'Starting cooldown…' : 'Begin unstake cooldown'}
                  </button>
                  <button
                    type="button"
                    disabled={!canWithdraw || !publicKey || !mintQuery.data || !walletBalanceQuery.data}
                    onClick={() =>
                      publicKey &&
                      mintQuery.data &&
                      walletBalanceQuery.data &&
                      withdrawMutation.mutate({
                        owner: publicKey,
                        stakeMint: mintQuery.data.address,
                        ownerTokenAccount: walletBalanceQuery.data.ata,
                        tokenProgram: mintQuery.data.tokenProgram,
                      })
                    }
                    className="inline-flex h-11 items-center justify-center bg-ink px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw unlocked stake'}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink/60">
                No position exists for this wallet yet. Stake from the form above to create the
                wallet’s first mainnet staking position.
              </p>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Live pool state" subtitle="Current on-chain rollout status on the active cluster.">
            <StatusRow
              label="Program"
              value={programInfo.data ? 'Deployed' : 'Not deployed on this cluster'}
              testId="staking-program-status"
            />
            <StatusRow
              label="Pool"
              value={
                poolQuery.data
                  ? `${poolQuery.data.paused ? 'Paused' : 'Live'} · epoch ${poolQuery.data.currentEpoch.toString()}`
                  : 'Awaiting init_pool'
              }
              testId="staking-pool-status"
            />
            <StatusRow
              label="Epoch cadence"
              value={poolQuery.data ? formatDuration(poolQuery.data.epochDurationSecs) : '—'}
            />
            <StatusRow
              label="Reward rate / epoch"
              value={
                poolQuery.data && mintQuery.data
                  ? `${formatTokenAmount(poolQuery.data.rewardRatePerEpoch, mintQuery.data.decimals, 4)} ${assetLabel}`
                  : '—'
              }
              testId="staking-reward-rate"
            />
            <StatusRow
              label="Rewards status"
              value={
                !poolQuery.data
                  ? 'Awaiting init_pool'
                  : rewardsLive
                    ? 'Reward emissions configured'
                    : 'Reward rate is 0'
              }
              testId="staking-rewards-status"
            />
            <StatusRow label="Config authority" value={configQuery.data ? truncate(configQuery.data.authority.toBase58()) : 'Not initialized'} mono />
            <StatusRow label="Stake mint" value={mintQuery.data ? truncate(mintQuery.data.address.toBase58()) : 'Awaiting pool init'} mono />
          </Panel>

          <Panel title="How staking works" subtitle="Current rules enforced by the live program.">
            <ul className="space-y-3 text-sm text-ink/70">
              <li>Locking longer increases voting weight up to 4x.</li>
              <li>Each wallet currently uses a single stake position PDA.</li>
              <li>Cooldown starts only after the full lock period expires.</li>
              <li>Rewards are still off until protocol fee routing goes live.</li>
            </ul>
          </Panel>

          <Panel title="Ops shortcuts" subtitle="Useful addresses while the rollout is still maturing.">
            <div className="border border-ink/10">
              <OpsLink
                label="Program ID"
                value={program.programId.toBase58()}
                href={explorerHref('address', program.programId.toBase58(), explorerBase)}
              />
              <OpsLink
                label="Config PDA"
                value={configPda.toBase58()}
                href={explorerHref('address', configPda.toBase58(), explorerBase)}
              />
              <OpsLink
                label="Pool PDA"
                value={poolPda.toBase58()}
                href={explorerHref('address', poolPda.toBase58(), explorerBase)}
              />
              {mintQuery.data ? (
                <OpsLink
                  label="Stake mint"
                  value={mintQuery.data.address.toBase58()}
                  href={explorerHref('address', mintQuery.data.address.toBase58(), explorerBase)}
                />
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-ink/10 bg-paper">
      <div className="border-b border-ink/10 px-5 py-4 md:px-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Staking
          </div>
          <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">{title}</h2>
          <p className="mt-1 text-sm text-ink/55">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-5 md:px-6">{children}</div>
    </div>
  );
}

function MetricCard({
  eyebrow,
  value,
  detail,
  testId,
}: {
  eyebrow: string;
  value: string;
  detail: string;
  testId?: string;
}) {
  return (
    <div className="border border-ink/10 bg-paper px-4 py-4" data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{eyebrow}</div>
      <div className="mt-3 font-display text-[24px] leading-[1.05] tracking-[-0.01em]">{value}</div>
      <div className="mt-2 text-xs text-ink/55">{detail}</div>
    </div>
  );
}

function FactBlock({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border border-ink/10 bg-paper-2 px-4 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</dt>
      <dd className={`mt-2 ${mono ? 'font-mono text-xs text-ink/75' : 'text-sm text-ink/80'}`}>{value}</dd>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink/10 px-4 py-3 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</span>
      <span className="font-mono text-right text-sm text-ink">{value}</span>
    </div>
  );
}

function StatusRow({
  label,
  value,
  mono = false,
  testId,
}: {
  label: string;
  value: string;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 border-b border-ink/8 py-2.5 last:border-b-0 last:pb-0"
      data-testid={testId}
    >
      <span className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</span>
      <span className={mono ? 'font-mono text-xs text-right text-ink/75' : 'text-right text-sm text-ink/75'}>{value}</span>
    </div>
  );
}

function OpsLink({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <div className="border-b border-ink/10 px-4 py-3 last:border-b-0">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <span className="font-mono text-xs text-ink/70">{truncate(value, 14)}</span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink/70 underline decoration-ink/25 underline-offset-4 hover:text-ink"
        >
          Open
        </a>
      </div>
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}

async function fetchNullableAccount(
  program: ReturnType<typeof nxsStakingProgram>,
  name: 'stakingConfig' | 'stakingPool' | 'stakeAccount',
  address: PublicKey,
): Promise<Record<string, unknown> | null> {
  const accountMap = program.account as Record<
    string,
    { fetchNullable: (addr: PublicKey) => Promise<unknown> }
  >;
  const accessor = accountMap[name];
  if (!accessor) throw new Error(`Missing account accessor for ${name}`);
  return (await accessor.fetchNullable(address)) as Record<string, unknown> | null;
}

function mapConfig(raw: Record<string, unknown>): ConfigView {
  return {
    authority: raw.authority as PublicKey,
    bump: Number(raw.bump),
  };
}

function mapPool(raw: Record<string, unknown>): PoolView {
  return {
    authority: raw.authority as PublicKey,
    pendingAuthority: (raw.pendingAuthority as PublicKey | null) ?? null,
    stakeMint: raw.stakeMint as PublicKey,
    totalStaked: toBigInt(raw.totalStaked),
    totalStakers: toNumber(raw.totalStakers),
    currentEpoch: toBigInt(raw.currentEpoch),
    epochDurationSecs: toNumber(raw.epochDurationSecs),
    epochStartTime: toNumber(raw.epochStartTime),
    rewardRatePerEpoch: toBigInt(raw.rewardRatePerEpoch),
    paused: Boolean(raw.paused),
    bump: toNumber(raw.bump),
  };
}

function mapStakePosition(raw: Record<string, unknown>): StakePositionView {
  return {
    owner: raw.owner as PublicKey,
    pool: raw.pool as PublicKey,
    amount: toBigInt(raw.amount),
    lockupEnd: toNumber(raw.lockupEnd),
    lockupMultiplier: toNumber(raw.lockupMultiplier),
    votingPower: toBigInt(raw.votingPower),
    stakedAt: toNumber(raw.stakedAt),
    cooldownStart: toNumber(raw.cooldownStart),
    pendingRewards: toBigInt(raw.pendingRewards),
    lastClaimEpoch: toBigInt(raw.lastClaimEpoch),
    status: decodeStatus(raw.status),
    bump: toNumber(raw.bump),
    vaultBump: toNumber(raw.vaultBump),
  };
}

function decodeStatus(status: unknown): StakePositionView['status'] {
  if (!status) return 'unknown';
  if (typeof status === 'string') {
    const normalized = status.toLowerCase();
    if (normalized === 'active' || normalized === 'cooldown' || normalized === 'withdrawn') {
      return normalized;
    }
    return 'unknown';
  }
  if (typeof status === 'object') {
    const key = Object.keys(status as Record<string, unknown>)[0]?.toLowerCase();
    if (key === 'active' || key === 'cooldown' || key === 'withdrawn') return key;
  }
  return 'unknown';
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  if (value && typeof value === 'object' && 'toString' in value) return BigInt(String(value));
  return 0n;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (value && typeof value === 'object' && 'toString' in value) return Number(String(value));
  return 0;
}

function truncate(value: string, chars = 6) {
  if (value.length <= chars * 2 + 1) return value;
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}

function stakeAssetLabel(address: PublicKey) {
  return address.toBase58() === MAINNET_SAEP_MINT ? 'SAEP' : 'stake token';
}

function parseTokenAmount(input: string, decimals: number): bigint | null {
  const normalized = input.trim();
  if (!normalized) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [wholeRaw, fractionRaw] = normalized.split('.');
  const whole = wholeRaw ?? '0';
  const fraction = fractionRaw ?? '';
  if (fraction.length > decimals) return null;
  const wholePart = BigInt(whole) * 10n ** BigInt(decimals);
  const fractionPart = BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  return wholePart + fractionPart;
}

function formatTokenAmount(amount: bigint, decimals: number, maxFractionDigits = 2) {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  if (fraction === 0n || maxFractionDigits === 0) return whole.toString();
  const fractionText = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, maxFractionDigits)
    .replace(/0+$/, '');
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

function computeLockMultiplier(lockupSecs: number): number {
  if (lockupSecs <= MIN_LOCKUP_SECS) return 1;
  const range = MAX_LOCKUP_SECS - MIN_LOCKUP_SECS;
  const elapsed = Math.min(lockupSecs - MIN_LOCKUP_SECS, range);
  const extra = Math.floor((elapsed * (MAX_MULTIPLIER - 1)) / range);
  return 1 + Math.min(extra, MAX_MULTIPLIER - 1);
}

function formatDuration(totalSeconds: number) {
  const days = Math.floor(totalSeconds / DAY);
  if (days >= 30 && days % 30 === 0) return `${days / 30} months`;
  return `${days} days`;
}

function formatRelativeTime(target: number, now: number) {
  const diff = target - now;
  const suffix = diff >= 0 ? 'left' : 'ago';
  const absolute = Math.abs(diff);
  const days = Math.floor(absolute / DAY);
  const hours = Math.floor((absolute % DAY) / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${suffix}`;
  if (hours > 0) return `${hours}h ${minutes}m ${suffix}`;
  return `${Math.max(minutes, 0)}m ${suffix}`;
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function statusHeadline(
  status: StakePositionView['status'],
  now: number,
  lockupEnd: number,
  cooldownEnd: number | null,
) {
  if (status === 'active') {
    return now >= lockupEnd
      ? 'Lockup complete, cooldown can begin'
      : `Locked for ${formatRelativeTime(lockupEnd, now)}`;
  }
  if (status === 'cooldown' && cooldownEnd != null) {
    return now >= cooldownEnd
      ? 'Cooldown finished, withdrawal available'
      : `Cooldown ends in ${formatRelativeTime(cooldownEnd, now)}`;
  }
  if (status === 'withdrawn') return 'Stake withdrawn';
  return 'Status unavailable';
}

function explorerClusterSuffix(cluster: string) {
  if (cluster === 'mainnet-beta') return '';
  if (cluster === 'devnet') return '?cluster=devnet';
  return '?cluster=custom';
}

function explorerHref(kind: 'address' | 'tx', value: string, suffix: string) {
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}
