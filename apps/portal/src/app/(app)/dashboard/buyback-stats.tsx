'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useTokenPrice } from '@saep/sdk-ui';

const FEE_COLLECTOR_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_COLLECTOR_PROGRAM_ID ?? '11111111111111111111111111111111',
);

const NXS_STAKING_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_NXS_STAKING ?? 'GjXfJ6MHb6SJ4XBK3qcpGw4n256qYPrDcXrNj6kf2i2Z',
);
const SAEP_MINT = 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump';
const STAKING_POOL_DISCRIMINATOR = Buffer.from([203, 19, 214, 220, 220, 154, 24, 102]);

interface BuybackData {
  epochRevenue: bigint;
  burnedThisEpoch: bigint;
  stakerShareThisEpoch: bigint;
  totalBurnedAllTime: bigint;
  estimatedApy: number;
}

function fmtUsdc(v: bigint): string {
  return `$${(Number(v) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function useStakedTvl() {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ['staking-pool-tvl'],
    staleTime: 30_000,
    queryFn: async (): Promise<bigint> => {
      const [poolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('staking_pool')],
        NXS_STAKING_PROGRAM_ID,
      );
      const info = await connection.getAccountInfo(poolPda, 'confirmed');
      if (!info?.data) return 0n;
      const data = Buffer.from(info.data);
      if (!data.subarray(0, 8).equals(STAKING_POOL_DISCRIMINATOR)) return 0n;
      // totalStaked is at offset 72 (8 disc + 32 authority + 1 pending_tag + [0|32] + 32 mint = varies)
      // safer: skip authority(32) + pending_tag(1) + mint(32), read u64
      let offset = 8 + 32; // disc + authority
      const pendingTag = data.readUInt8(offset);
      offset += 1;
      if (pendingTag === 1) offset += 32;
      offset += 32; // stakeMint
      return data.readBigUInt64LE(offset);
    },
  });
}

function useBuybackStats() {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ['buyback-stats'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<BuybackData> => {
      const [configAddr] = PublicKey.findProgramAddressSync(
        [Buffer.from('fee_config')],
        FEE_COLLECTOR_PROGRAM_ID,
      );

      const info = await connection.getAccountInfo(configAddr);
      if (!info?.data) {
        return {
          epochRevenue: 0n,
          burnedThisEpoch: 0n,
          stakerShareThisEpoch: 0n,
          totalBurnedAllTime: 0n,
          estimatedApy: 0,
        };
      }

      const data = info.data;
      const epochRevenue = data.readBigUInt64LE(8);
      const burnBps = data.readUInt16LE(16);
      const stakerBps = data.readUInt16LE(18);
      const totalBurned = data.readBigUInt64LE(24);

      const burned = (epochRevenue * BigInt(burnBps)) / 10_000n;
      const stakerShare = (epochRevenue * BigInt(stakerBps)) / 10_000n;

      return {
        epochRevenue,
        burnedThisEpoch: burned,
        stakerShareThisEpoch: stakerShare,
        totalBurnedAllTime: totalBurned,
        estimatedApy: 0,
      };
    },
  });
}

export function BuybackStats() {
  const { data, isLoading } = useBuybackStats();
  const { data: stakedTvl } = useStakedTvl();
  const { data: tokenPrice } = useTokenPrice(SAEP_MINT);

  const realApy = useMemo(() => {
    if (!data || !stakedTvl || stakedTvl === 0n || !tokenPrice) return null;
    const annualStakerUsdc = Number(data.stakerShareThisEpoch) * 365;
    const tvlUsdc = (Number(stakedTvl) / 1e6) * tokenPrice.price;
    if (tvlUsdc <= 0) return null;
    return (annualStakerUsdc / (tvlUsdc * 1e6)) * 100;
  }, [data, stakedTvl, tokenPrice]);

  return (
    <div className="border border-ink/10 bg-paper">
      <div className="border-b border-ink/10 px-4 py-3 flex items-center justify-between">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase">
          buyback &amp; distribute
        </div>
        <div className="font-mono text-[10px] text-mute">live</div>
      </div>

      {isLoading ? (
        <div className="px-4 py-6 font-mono text-[11px] text-mute">Loading...</div>
      ) : !data ? (
        <div className="px-4 py-6 font-mono text-[11px] text-mute">No data</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-ink/5">
          <Stat label="Epoch Revenue" value={fmtUsdc(data.epochRevenue)} />
          <Stat
            label="Staker Share"
            value={fmtUsdc(data.stakerShareThisEpoch)}
            sub="→ Jupiter DCA → SAEP"
          />
          <Stat label="Burned" value={fmtUsdc(data.burnedThisEpoch)} sub="deflationary" />
          <Stat
            label="Total Burned"
            value={fmtUsdc(data.totalBurnedAllTime)}
            sub="all time"
          />
          <Stat
            label="Est. APY"
            value={realApy != null ? `${realApy.toFixed(1)}%` : '—'}
            sub={realApy != null ? 'from real fees + TVL' : 'awaiting data'}
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-paper px-4 py-3">
      <div className="font-mono text-[10px] text-mute tracking-wider uppercase">{label}</div>
      <div className="font-display text-lg tracking-tight mt-0.5">{value}</div>
      {sub && <div className="font-mono text-[9px] text-mute mt-0.5">{sub}</div>}
    </div>
  );
}
