import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';

export const metadata: Metadata = {
  title: 'Tokenomics',
  description: 'SAEP token distribution, fee mechanics, staking, and burn schedule.',
};

const distribution = [
  { label: 'Circulating supply', pct: '90%', note: 'Available at launch' },
  { label: 'Team allocation', pct: '10%', note: 'Locked via Streamflow — 12-month linear vest' },
];

const feeFlow = [
  { label: 'Staker rewards', pct: '50%', color: 'bg-lime' },
  { label: 'Grant pool', pct: '20%', color: 'bg-amber-400' },
  { label: 'Protocol treasury', pct: '20%', color: 'bg-sky-400' },
  { label: 'Permanent burn', pct: '10%', color: 'bg-red-400' },
];

const extensions = [
  { name: 'TransferHook', role: 'Routes 0.1% protocol fee on every transfer to FeeCollector' },
  { name: 'TransferFee', role: '0.1% built-in fee — combined with hook = 0.2% net per transfer' },
  { name: 'PermanentDelegate', role: 'Enables protocol burns — the only legal burn path (mint authority is None)' },
  { name: 'InterestBearing', role: 'Accrues yield on staked tokens — no inflation, no reward minting' },
  { name: 'Pausable', role: 'Emergency circuit breaker — 4-of-7 multisig controlled' },
  { name: 'MetadataPointer', role: 'On-chain metadata stored inline — no external dependency' },
];

const stakingTiers = [
  { lock: '30 days', multiplier: '1×', note: 'Minimum to vote' },
  { lock: '90 days', multiplier: '1.5×', note: 'Standard lock' },
  { lock: '365 days', multiplier: '3×', note: 'Long-term alignment' },
  { lock: '4 years', multiplier: '4×', note: 'Maximum commitment' },
];

export default function TokenomicsPage() {
  return (
    <PageShell
      eyebrow="Tokenomics"
      title="Token economics"
      lede="$SAEP is a Token-2022 asset with protocol-level fee mechanics, staking, and permanent burn — enforced by on-chain programs, not promises."
    >
      <div className="mt-16 space-y-20">
        {/* Distribution */}
        <section>
          <h2 className="font-display text-2xl mb-6">Distribution</h2>
          <div className="space-y-4">
            {distribution.map((d) => (
              <div key={d.label} className="flex items-baseline justify-between border-b border-ink/10 pb-3">
                <div>
                  <span className="font-mono text-[13px]">{d.label}</span>
                  <span className="ml-3 font-mono text-[11px] text-mute">{d.note}</span>
                </div>
                <span className="font-mono text-[15px] font-medium">{d.pct}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] text-mute leading-relaxed">
            No VC allocation. No private rounds. No mint authority — supply is permanently fixed at launch.
          </p>
        </section>

        {/* Fee distribution */}
        <section>
          <h2 className="font-display text-2xl mb-6">Fee distribution</h2>
          <p className="font-mono text-[12px] text-ink/80 leading-relaxed mb-6">
            Every $SAEP transfer incurs a 0.2% protocol fee (0.1% TransferFee + 0.1% TransferHook).
            Collected fees are split per epoch across four sinks:
          </p>
          <div className="flex gap-1 h-8 rounded overflow-hidden mb-4">
            {feeFlow.map((f) => (
              <div
                key={f.label}
                className={`${f.color} opacity-80`}
                style={{ width: f.pct }}
                title={`${f.label}: ${f.pct}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {feeFlow.map((f) => (
              <div key={f.label}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`h-2 w-2 rounded-full ${f.color} opacity-80`} />
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">{f.label}</span>
                </div>
                <span className="font-mono text-[15px] font-medium">{f.pct}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] text-mute leading-relaxed">
            Ratios are governance-adjustable. Burns use PermanentDelegate — the only burn path since mint authority is permanently None.
          </p>
        </section>

        {/* Staking */}
        <section>
          <h2 className="font-display text-2xl mb-6">Staking</h2>
          <p className="font-mono text-[12px] text-ink/80 leading-relaxed mb-6">
            Stake $SAEP to vote on governance proposals, operate as a dispute arbitrator,
            and earn epoch fee distributions. Longer locks earn higher voting power multipliers.
          </p>
          <div className="border border-ink/10">
            <div className="grid grid-cols-3 gap-4 px-4 py-2 border-b border-ink/10 font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
              <span>Lock period</span>
              <span>Voting power</span>
              <span>Note</span>
            </div>
            {stakingTiers.map((t) => (
              <div key={t.lock} className="grid grid-cols-3 gap-4 px-4 py-3 border-b border-ink/5 last:border-0 font-mono text-[12px]">
                <span>{t.lock}</span>
                <span className="text-lime">{t.multiplier}</span>
                <span className="text-mute">{t.note}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 font-mono text-[11px] text-mute leading-relaxed">
            <p>Yield accrues via InterestBearing extension — no token minting, no supply inflation.</p>
            <p>Slashing: 10% max per incident, 30-day timelock before execution, appeal window for operators.</p>
          </div>
        </section>

        {/* Token-2022 extensions */}
        <section>
          <h2 className="font-display text-2xl mb-6">Token-2022 extensions</h2>
          <p className="font-mono text-[12px] text-ink/80 leading-relaxed mb-6">
            Six extensions chosen at mint initialization. Extension set is permanent per Token-2022 semantics.
          </p>
          <div className="space-y-3">
            {extensions.map((e) => (
              <div key={e.name} className="flex items-start gap-4 border-b border-ink/5 pb-3 last:border-0">
                <span className="font-mono text-[12px] text-lime shrink-0 w-40">{e.name}</span>
                <span className="font-mono text-[11px] text-ink/70 leading-relaxed">{e.role}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Security */}
        <section>
          <h2 className="font-display text-2xl mb-6">Security guarantees</h2>
          <ul className="space-y-3 font-mono text-[12px] text-ink/80 leading-relaxed">
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime/60" />
              Mint authority set to None at launch — no future minting possible
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime/60" />
              Freeze authority set to None — tokens cannot be frozen
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime/60" />
              4-of-7 multisig for emergency pause, 7-day upgrade timelock
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime/60" />
              Fee distribution ratios require governance vote to change
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime/60" />
              Every fee, slash, and distribution is on-chain and indexer-replayable
            </li>
          </ul>
        </section>
      </div>

      <div className="mt-24 border-t border-ink/10 pt-10">
        <p className="font-mono text-[11px] text-mute leading-relaxed max-w-xl">
          Token mechanics are enforced by on-chain programs, not off-chain promises.
          Review the source at{' '}
          <a
            href="https://github.com/SolanaAEP/saep"
            target="_blank"
            rel="noopener noreferrer"
            className="text-lime hover:underline"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </PageShell>
  );
}
