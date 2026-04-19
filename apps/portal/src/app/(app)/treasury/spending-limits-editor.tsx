'use client';

import { useEffect, useState } from 'react';
import { GlitchButton } from '@saep/ui';
import type { AgentSummary } from '@saep/sdk';
import { useTreasury, useSetLimits } from '@saep/sdk-ui';

function solToLamports(sol: string): bigint {
  const n = Number(sol);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.floor(n * 1e9));
}

function lamportsToSol(l: bigint): string {
  return (Number(l) / 1e9).toFixed(4);
}

export function SpendingLimitsEditor({ agent }: { agent: AgentSummary }) {
  const { data: treasury } = useTreasury(agent.did);
  const { mutateAsync, isPending, error } = useSetLimits();

  const [perTx, setPerTx] = useState('');
  const [daily, setDaily] = useState('');
  const [weekly, setWeekly] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (treasury) {
      setPerTx(lamportsToSol(treasury.perTxLimit));
      setDaily(lamportsToSol(treasury.dailySpendLimit));
      setWeekly(lamportsToSol(treasury.weeklyLimit));
    }
  }, [treasury]);

  if (!treasury) {
    return (
      <div className="border border-dashed border-ink/20 p-5 text-xs text-ink/50">
        Spending limits — initialize treasury first.
      </div>
    );
  }

  const perTxLamports = solToLamports(perTx);
  const dailyLamports = solToLamports(daily);
  const weeklyLamports = solToLamports(weekly);

  const dirty =
    perTxLamports !== treasury.perTxLimit ||
    dailyLamports !== treasury.dailySpendLimit ||
    weeklyLamports !== treasury.weeklyLimit;

  const invalid =
    perTxLamports > dailyLamports ||
    dailyLamports * 7n < weeklyLamports ||
    weeklyLamports === 0n;

  async function submit() {
    setStatus(null);
    const sig = await mutateAsync({
      agentDid: agent.did,
      daily: dailyLamports,
      perTx: perTxLamports,
      weekly: weeklyLamports,
    });
    setStatus(`Updated: ${sig.slice(0, 16)}…`);
  }

  return (
    <div className="border border-ink/10 p-5 flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Spending limits</h2>
        <span className="text-[10px] text-ink/50">Enforced by treasury_standard set_limits</span>
      </header>

      <div className="grid sm:grid-cols-3 gap-4 text-xs">
        <LimitField label="Per-tx" value={perTx} onChange={setPerTx} hint="Per single withdrawal" />
        <LimitField label="Daily" value={daily} onChange={setDaily} hint="24-hour rolling cap" />
        <LimitField label="Weekly" value={weekly} onChange={setWeekly} hint="7-day rolling cap" />
      </div>

      {invalid && (
        <p className="text-[11px] text-danger">
          Limits must satisfy per-tx ≤ daily ≤ weekly/7 and weekly &gt; 0.
        </p>
      )}

      {error && <p className="text-[11px] text-danger">{(error as Error).message}</p>}
      {status && <p className="text-[11px] text-lime">{status}</p>}

      <div className="flex justify-end">
        <GlitchButton variant="solid" size="sm" onClick={submit} disabled={!dirty || invalid || isPending}>{isPending ? 'Updating…' : 'Save limits'}</GlitchButton>
      </div>
    </div>
  );
}

function LimitField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  const lamports = solToLamports(value);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink/60">{label} (SOL)</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 bg-ink/5 border border-ink/10 font-mono focus:outline-none focus:border-lime"
      />
      <span className="text-[10px] text-ink/40 font-mono">{lamports.toString()} lamports · {hint}</span>
    </label>
  );
}

