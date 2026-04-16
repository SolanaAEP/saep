'use client';

import type { AgentSummary } from '@saep/sdk';
import { useAllowedMints, useVaultBalances, useTreasury } from '@saep/sdk-ui';

type Meta = { symbol: string; decimals: number; badge?: string };

const KNOWN: Record<string, Meta> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
  '6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2': {
    symbol: 'wXRP',
    decimals: 6,
    badge: 'Experimental — low liquidity',
  },
};

function meta(mint: string): Meta {
  return KNOWN[mint] ?? { symbol: mint.slice(0, 4), decimals: 9 };
}

function fmtAmount(raw: bigint, decimals: number): string {
  const denom = 10n ** BigInt(decimals);
  const whole = raw / denom;
  const frac = Number(raw % denom) / Number(denom);
  return (Number(whole) + frac).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function MultiAssetBalanceTable({ agent }: { agent: AgentSummary }) {
  const { data: mints, isLoading: mintsLoading } = useAllowedMints();
  const { data: balances, isLoading: balLoading } = useVaultBalances(agent.did, mints ?? []);
  const { data: treasury } = useTreasury(agent.did);

  const loading = mintsLoading || balLoading;

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Balances</h2>
        <span className="text-[10px] text-ink/50">{balances?.filter((b) => b.exists).length ?? 0} vaults</span>
      </header>

      {!treasury && (
        <p className="text-xs text-ink/50">
          Treasury not yet initialized for this agent. Register in the agent wizard or call initTreasury.
        </p>
      )}

      {loading && <p className="text-xs text-ink/50">Loading vaults…</p>}

      {!loading && (!mints || mints.length === 0) && (
        <p className="text-xs text-ink/50">No allowed mints configured yet in treasury_standard.</p>
      )}

      {balances && balances.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-ink/50 text-left border-b border-ink/10">
              <th className="py-2 font-normal">Asset</th>
              <th className="py-2 font-normal">Mint</th>
              <th className="py-2 font-normal text-right">Balance</th>
              <th className="py-2 font-normal text-right">Vault</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => {
              const m = meta(b.mint.toBase58());
              return (
                <tr key={b.vault.toBase58()} className="border-b border-ink/5 last:border-0">
                  <td className="py-2.5">
                    <span>{m.symbol}</span>
                    {m.badge && (
                      <span
                        className="ml-2 text-[10px] px-1.5 py-0.5 rounded border align-middle border-ink/20 text-ink/60"
                        title={m.badge}
                      >
                        {m.badge}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 font-mono text-ink/50">{b.mint.toBase58().slice(0, 8)}…</td>
                  <td className="py-2.5 text-right font-mono">
                    {b.exists ? fmtAmount(b.amount, m.decimals) : <span className="text-ink/40">—</span>}
                  </td>
                  <td className="py-2.5 text-right font-mono text-ink/50">
                    {b.vault.toBase58().slice(0, 8)}…
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
