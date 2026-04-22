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

type ProgramStage = 'not-deployed' | 'deployed' | 'configured' | 'ready';

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
  const rewardsBanner =
    poolQuery.data && !rewardsLive
      ? cluster.cluster === 'mainnet-beta'
        ? 'Mainnet staking positions are live, but rewards are not active yet. The current on-chain reward rate is 0, and fee routing into staking remains a later rollout step.'
        : 'This staking pool currently has a reward rate of 0. Position management is live, but rewards are not active on this cluster.'
      : null;

  const stage: ProgramStage = !programInfo.data
    ? 'not-deployed'
    : !configQuery.data
      ? 'deployed'
      : !poolQuery.data
        ? 'configured'
        : 'ready';

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
    <section className="flex flex-col gap-6 max-w-7xl" data-testid="staking-shell">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-lime">
            SAEP staking surface
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Stake, lock, and track operator weight</h1>
          <p className="max-w-3xl text-sm text-ink/65">
            This page reads the live `nxs_staking` program on the active cluster, shows whether the
            pool is actually initialized, and only enables transactions when the current deployment
            can support them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={stageTone(stage)} testId="staking-stage-badge">
            {stageLabel(stage)}
          </Badge>
          <a
            href={explorerHref('address', program.programId.toBase58(), explorerBase)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-ink/10 px-3 py-1.5 text-xs font-mono text-ink/70 transition-colors hover:border-ink/25 hover:text-ink"
          >
            Program on Explorer
          </a>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          eyebrow="Program"
          value={programInfo.data ? 'Deployed' : 'Awaiting deploy'}
          detail={truncate(program.programId.toBase58())}
          testId="staking-program-card"
        />
        <MetricCard
          eyebrow="Pool"
          value={poolQuery.data ? 'Initialized' : 'Pending'}
          detail={truncate(poolPda.toBase58())}
          testId="staking-pool-card"
        />
        <MetricCard
          eyebrow="Total staked"
          value={poolQuery.data && mintQuery.data
            ? formatTokenAmount(poolQuery.data.totalStaked, mintQuery.data.decimals)
            : '—'}
          detail={poolQuery.data ? `${poolQuery.data.totalStakers} stakers` : 'No pool data yet'}
          testId="staking-total-staked-card"
        />
        <MetricCard
          eyebrow="Your position"
          value={position && mintQuery.data ? formatTokenAmount(position.amount, mintQuery.data.decimals) : 'None'}
          detail={position ? statusHeadline(position.status, now, position.lockupEnd, cooldownEnd) : 'Connect a wallet to act'}
          testId="staking-position-card"
        />
      </div>

      {(programInfo.error || configQuery.error || poolQuery.error || mintQuery.error || positionQuery.error || walletBalanceQuery.error) && (
        <div className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
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

      {rewardsBanner ? (
        <div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700"
          data-testid="staking-rewards-banner"
        >
          {rewardsBanner}
        </div>
      ) : null}

      {lastAction ? (
        <div className="rounded-2xl border border-lime/30 bg-lime/5 px-4 py-3 text-sm text-ink/80">
          {lastAction}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel
          title="Stake position"
          subtitle="Wallet-aware controls with on-chain guardrails"
          accent="lime"
        >
          {!connected ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-ink/15 bg-paper-2/70 p-5">
              <p className="text-sm text-ink/65">
                Connect your Solana wallet to create a stake position, begin cooldown, or withdraw
                unlocked stake.
              </p>
              <div>
                <WalletMultiButton />
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-ink/10 bg-paper-2/80 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">Current wallet</h2>
                {publicKey ? (
                  <span className="font-mono text-xs text-ink/55">{truncate(publicKey.toBase58())}</span>
                ) : null}
              </div>

              <dl className="grid gap-3 text-sm">
                <Fact label="Stake account" value={stakePda ? truncate(stakePda.toBase58()) : 'Connect wallet'} mono />
                <Fact
                  label="Stake mint"
                  value={mintQuery.data ? truncate(mintQuery.data.address.toBase58()) : 'Awaiting pool init'}
                  mono
                />
                <Fact
                  label="Wallet balance"
                  value={walletBalanceQuery.data && mintQuery.data
                    ? formatTokenAmount(walletBalanceQuery.data.amount, mintQuery.data.decimals)
                    : walletBalanceQuery.data?.exists === false
                      ? 'ATA missing'
                      : '—'}
                />
                <Fact
                  label="Wallet ATA"
                  value={walletBalanceQuery.data ? truncate(walletBalanceQuery.data.ata.toBase58()) : '—'}
                  mono
                />
              </dl>

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
                  className="mt-4 h-10 w-full rounded-full border border-ink/15 bg-paper px-4 text-sm font-medium transition-colors hover:border-ink/25"
                >
                  {createAtaMutation.isPending ? 'Creating token account…' : 'Create stake token account'}
                </button>
              ) : null}

              {walletBalanceQuery.data?.exists === false ? (
                <p className="mt-3 text-xs text-ink/55">
                  This wallet does not have a stake token account yet. Create the ATA first, then
                  fund it before staking.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-ink/10 bg-paper-2/80 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">Position lifecycle</h2>
                {position ? <Badge tone={statusTone(position.status)}>{position.status}</Badge> : null}
              </div>

              {position && mintQuery.data ? (
                <dl className="grid gap-3 text-sm">
                  <Fact label="Staked amount" value={formatTokenAmount(position.amount, mintQuery.data.decimals)} />
                  <Fact label="Voting power" value={formatTokenAmount(position.votingPower, mintQuery.data.decimals)} />
                  <Fact label="Multiplier" value={`${position.lockupMultiplier}x`} />
                  <Fact label="Stake vault" value={stakeVault ? truncate(stakeVault.toBase58()) : '—'} mono />
                  <Fact label="Lockup ends" value={formatTimestamp(position.lockupEnd)} />
                  <Fact
                    label="Status detail"
                    value={statusHeadline(position.status, now, position.lockupEnd, cooldownEnd)}
                  />
                </dl>
              ) : (
                <p className="text-sm text-ink/60">
                  No position exists for this wallet yet. The current staking build supports one
                  position PDA per wallet, so this surface stays conservative about replaying a
                  withdrawn position.
                </p>
              )}

              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={!canBeginUnstake || !publicKey}
                  onClick={() => publicKey && beginUnstakeMutation.mutate({ owner: publicKey })}
                  className="h-10 rounded-full border border-ink/15 bg-paper px-4 text-sm font-medium transition-colors hover:border-ink/25 disabled:cursor-not-allowed disabled:opacity-45"
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
                  className="h-10 rounded-full bg-ink px-4 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw unlocked stake'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[28px] border border-ink/10 bg-[#11150f] px-5 py-6 text-paper">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-lime/80">
                  New stake
                </div>
                <h2 className="mt-1 text-xl font-semibold">Open a locked position</h2>
              </div>
              <div className="text-right text-xs text-paper/60">
                <div>Lock range</div>
                <div>{formatDuration(MIN_LOCKUP_SECS)} → {formatDuration(MAX_LOCKUP_SECS)}</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <label className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-paper/55">Amount</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountInput}
                    onChange={(event) => setAmountInput(event.target.value)}
                    placeholder={mintQuery.data ? `0.0 ${mintQuery.data.decimals > 0 ? '' : '(whole tokens)'}` : '0.0'}
                    className="h-12 rounded-2xl border border-paper/15 bg-paper/8 px-4 font-mono text-lg text-paper placeholder:text-paper/30 focus:border-lime/70 focus:outline-none"
                  />
                </label>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-[0.16em] text-paper/55">Lock duration</span>
                    <span className="font-mono text-xs text-lime">
                      {lockDays} days · {previewMultiplier}x weight
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {LOCK_PRESETS.map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setLockDays(days)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-mono transition-colors ${
                          lockDays === days
                            ? 'border-lime bg-lime/10 text-lime'
                            : 'border-paper/15 text-paper/70 hover:border-paper/35'
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
                    className="w-full accent-lime"
                  />
                </div>

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
                  className="h-12 w-full rounded-full bg-lime px-5 text-sm font-semibold text-[#11150f] transition-transform hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:bg-paper/20 disabled:text-paper/45"
                >
                  {stakeMutation.isPending ? 'Submitting stake…' : 'Stake tokens'}
                </button>

                <p className="text-xs text-paper/55">
                  This page mirrors the current on-chain math: one stake position per wallet, a
                  3-day cooldown after lock expiry, and voting power boosted by longer lockups.
                </p>
              </div>

              <div className="rounded-3xl border border-paper/10 bg-paper/6 p-4">
                <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/55">
                  Preview
                </div>
                <div className="space-y-3 text-sm text-paper/75">
                  <PreviewRow
                    label="Stake amount"
                    value={stakePreviewAmount != null && mintQuery.data
                      ? formatTokenAmount(stakePreviewAmount, mintQuery.data.decimals, 4)
                      : 'Enter an amount'}
                  />
                  <PreviewRow label="Voting power" value={
                    previewVotingPower != null && mintQuery.data
                      ? formatTokenAmount(previewVotingPower, mintQuery.data.decimals, 4)
                      : '—'
                  } />
                  <PreviewRow label="Lockup ends" value={formatTimestamp(now + lockupSecs)} />
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
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel
            title="Cluster status"
            subtitle="Real-time rollout state"
            accent="ink"
          >
            <StatusRow
              label="Program"
              value={programInfo.data ? 'Deployed' : 'Not deployed on this cluster'}
              testId="staking-program-status"
            />
            <StatusRow label="Config PDA" value={truncate(configPda.toBase58())} mono />
            <StatusRow
              label="Config"
              value={configQuery.data ? `Authority ${truncate(configQuery.data.authority.toBase58())}` : 'Not initialized'}
            />
            <StatusRow label="Pool PDA" value={truncate(poolPda.toBase58())} mono />
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
              value={poolQuery.data && mintQuery.data
                ? formatTokenAmount(poolQuery.data.rewardRatePerEpoch, mintQuery.data.decimals)
                : '—'}
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
          </Panel>

          <Panel
            title="What this page supports"
            subtitle="Matched to the current `nxs_staking` program"
            accent="ink"
          >
            <ul className="space-y-3 text-sm text-ink/70">
              <li>Live program, config, and pool status detection on the active cluster.</li>
              <li>Stake position preview with the on-chain lockup multiplier mirrored in the UI.</li>
              <li>Wallet token account creation, stake, begin-unstake, and withdraw flows.</li>
              <li>Explicit pending states when the program is deployed but not initialized yet.</li>
            </ul>
          </Panel>

          <Panel
            title="Ops shortcuts"
            subtitle="Useful addresses while the rollout is still in flight"
            accent="ink"
          >
            <div className="space-y-4 text-sm">
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
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: 'lime' | 'ink';
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[30px] border border-ink/10 bg-paper/80 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.05)] md:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-ink/55">{subtitle}</p>
        </div>
        <div className={`h-2 w-16 rounded-full ${accent === 'lime' ? 'bg-lime' : 'bg-ink/15'}`} />
      </div>
      {children}
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
    <div className="rounded-[26px] border border-ink/10 bg-paper/70 p-4" data-testid={testId}>
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink/45">{eyebrow}</div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-ink/55">{detail}</div>
    </div>
  );
}

function Badge({
  tone,
  children,
  testId,
}: {
  tone: 'lime' | 'amber' | 'danger' | 'muted';
  children: React.ReactNode;
  testId?: string;
}) {
  const palette =
    tone === 'lime'
      ? 'border-lime/30 bg-lime/10 text-lime'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
        : tone === 'danger'
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-ink/10 bg-paper text-ink/60';
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-[0.12em] ${palette}`}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink/50">{label}</dt>
      <dd className={mono ? 'font-mono text-right text-xs text-ink/75' : 'text-right text-ink/80'}>{value}</dd>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-paper/55">{label}</span>
      <span className="font-mono text-right text-paper">{value}</span>
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
      <span className="text-ink/45">{label}</span>
      <span className={mono ? 'font-mono text-xs text-right text-ink/75' : 'text-right text-ink/75'}>{value}</span>
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
    <div className="rounded-2xl border border-ink/10 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.16em] text-ink/40">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <span className="font-mono text-xs text-ink/70">{truncate(value, 14)}</span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-ink/70 underline decoration-ink/25 underline-offset-4 hover:text-ink"
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

function stageLabel(stage: ProgramStage) {
  if (stage === 'not-deployed') return 'not deployed';
  if (stage === 'deployed') return 'program only';
  if (stage === 'configured') return 'config live';
  return 'pool ready';
}

function stageTone(stage: ProgramStage): 'lime' | 'amber' | 'danger' | 'muted' {
  if (stage === 'ready') return 'lime';
  if (stage === 'configured' || stage === 'deployed') return 'amber';
  return 'danger';
}

function statusTone(status: StakePositionView['status']): 'lime' | 'amber' | 'danger' | 'muted' {
  if (status === 'active') return 'lime';
  if (status === 'cooldown') return 'amber';
  if (status === 'withdrawn') return 'muted';
  return 'danger';
}

function explorerClusterSuffix(cluster: string) {
  if (cluster === 'mainnet-beta') return '';
  if (cluster === 'devnet') return '?cluster=devnet';
  return '?cluster=custom';
}

function explorerHref(kind: 'address' | 'tx', value: string, suffix: string) {
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}
