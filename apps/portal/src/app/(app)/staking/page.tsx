import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Staking — SAEP',
  description: 'Lock SAEP tokens. Earn protocol fees. Govern the protocol.',
};

const TIERS = [
  { days: 7, label: '7 days', multiplier: '1x' },
  { days: 30, label: '30 days', multiplier: '1.5x' },
  { days: 90, label: '90 days', multiplier: '2.5x' },
  { days: 180, label: '180 days', multiplier: '4x' },
  { days: 365, label: '365 days', multiplier: '6x' },
] as const;

const STEPS = [
  { num: '01', title: 'Lock SAEP tokens', desc: 'Choose a lockup period from 7 to 365 days.' },
  { num: '02', title: 'Earn protocol fee share', desc: 'Receive a proportional cut of all protocol fees.' },
  { num: '03', title: 'Vote on governance proposals', desc: 'Staked tokens grant voting weight in protocol governance.' },
] as const;

const BUCKETS = [
  { label: 'Burn', pct: 10, color: 'bg-red-500' },
  { label: 'Stakers', pct: 50, color: 'bg-lime' },
  { label: 'Grants', pct: 20, color: 'bg-sky-400' },
  { label: 'Treasury', pct: 20, color: 'bg-amber-400' },
] as const;

export default function StakingPage() {
  return (
    <section className="flex flex-col gap-10 max-w-4xl">
      {/* Header */}
      <header className="flex flex-col gap-1 border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
          12 // token staking
        </div>
        <h1 className="font-display text-2xl tracking-tight">Staking</h1>
        <p className="text-sm text-mute mt-1">
          Lock SAEP. Earn fees. Govern the protocol.
        </p>
      </header>

      {/* How It Works */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg tracking-tight">How It Works</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div
              key={step.num}
              className="border border-ink/10 p-4 flex flex-col gap-2"
            >
              <span className="font-mono text-[10px] text-mute tracking-widest">
                STEP {step.num}
              </span>
              <span className="font-display text-sm">{step.title}</span>
              <span className="text-xs text-mute leading-relaxed">{step.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Lockup Tiers */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg tracking-tight">Lockup Tiers</h2>
        <div className="border border-ink/10 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ink/10 bg-paper">
                <th className="font-mono text-[10px] text-mute tracking-widest uppercase px-4 py-2.5 font-normal">
                  Duration
                </th>
                <th className="font-mono text-[10px] text-mute tracking-widest uppercase px-4 py-2.5 font-normal text-right">
                  Multiplier
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-sm">
              {TIERS.map((tier) => (
                <tr key={tier.days} className="border-b border-ink/10 last:border-0">
                  <td className="px-4 py-2.5">{tier.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{tier.multiplier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fee Distribution */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg tracking-tight">Fee Distribution</h2>
        <div className="flex h-8 w-full overflow-hidden border border-ink/10">
          {BUCKETS.map((b) => (
            <div
              key={b.label}
              className={`${b.color} h-full`}
              style={{ width: `${b.pct}%` }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {BUCKETS.map((b) => (
            <span key={b.label} className="flex items-center gap-1.5 font-mono text-[10px] text-mute">
              <span className={`inline-block h-2 w-2 ${b.color}`} />
              {b.label} — {b.pct}%
            </span>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="flex flex-col gap-3 border border-ink/10 p-5">
        <h2 className="font-display text-lg tracking-tight">Status</h2>
        <p className="text-sm text-mute leading-relaxed">
          Staking launches after OtterSec M1 audit completion. Code is live and open source.
        </p>
        <a
          href="https://github.com/SolanaAEP/saep/tree/main/programs"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-lime hover:underline tracking-widest uppercase w-fit"
        >
          View program code on GitHub →
        </a>
      </div>
    </section>
  );
}
