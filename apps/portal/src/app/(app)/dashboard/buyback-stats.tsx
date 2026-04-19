'use client';

import { useQuery } from '@tanstack/react-query';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

const FEE_COLLECTOR_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_COLLECTOR_PROGRAM_ID ?? '11111111111111111111111111111111',
);

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

      const annualRevenue = epochRevenue * 365n;
      const annualStakerShare = (annualRevenue * BigInt(stakerBps)) / 10_000n;
      const tvlEstimate = 1_000_000n * 1_000_000n;
      const apy = tvlEstimate > 0n
        ? Number(annualStakerShare * 10_000n / tvlEstimate) / 100
        : 0;

      return {
        epochRevenue,
        burnedThisEpoch: burned,
        stakerShareThisEpoch: stakerShare,
        totalBurnedAllTime: totalBurned,
        estimatedApy: apy,
      };
    },
  });
}

export function BuybackStats() {
  const { data, isLoading } = useBuybackStats();

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-ink/5">
          <Stat label="Epoch Revenue" value={fmtUsdc(data.epochRevenue)} />
          <Stat
            label="Staker Share"
            value={fmtUsdc(data.stakerShareThisEpoch)}
            sub="→ Jupiter DCA → SAEP"
          />
          <Stat label="Burned" value={fmtUsdc(data.burnedThisEpoch)} sub="deflationary" />
          <Stat
            label="Est. APY"
            value={`${data.estimatedApy.toFixed(1)}%`}
            sub="from real protocol fees"
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
