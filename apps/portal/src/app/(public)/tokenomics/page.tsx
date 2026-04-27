import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/website/page-shell';

export const metadata: Metadata = {
  title: 'Tokenomics',
  description:
    '$SAEP token economics: live mint state, CPI-driven fee flow, staking distribution model, buyback-and-burn cadence, retro vesting.',
};

const SAEP_MINT = 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump';
const EXPLORER = `https://solscan.io/token/${SAEP_MINT}`;

const mintFacts = [
  { k: 'Mint address', v: SAEP_MINT, mono: true },
  { k: 'Token program', v: 'Token-2022 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)', mono: true },
  { k: 'Decimals', v: '6' },
  { k: 'Total supply', v: '999,990,151.438427 SAEP (≈1B, fixed)' },
  { k: 'Mint authority', v: 'None (renounced)' },
  { k: 'Freeze authority', v: 'None (renounced)' },
  { k: 'Metadata authority', v: 'None (immutable)' },
  { k: 'Launched via', v: 'pump.fun bonding curve, post-graduation' },
];

const extensions = [
  {
    name: 'metadataPointer',
    present: true,
    role: 'Self-referential — metadata stored in the mint account itself.',
  },
  {
    name: 'tokenMetadata',
    present: true,
    role: 'Name, symbol, IPFS URI. Update authority None (immutable).',
  },
  {
    name: 'TransferHook',
    present: false,
    role: 'Aspirational. Not on the live mint — fees are captured at task-settlement time only.',
  },
  {
    name: 'TransferFee',
    present: false,
    role: 'Aspirational. Not on the live mint — no automatic per-transfer fee.',
  },
  {
    name: 'PermanentDelegate',
    present: false,
    role: 'Aspirational. Not on the live mint — protocol cannot claw back lost or stolen SAEP.',
  },
  {
    name: 'InterestBearing',
    present: false,
    role: 'Aspirational. Not on the live mint — staking yields a real epoch distribution, not a native rebase.',
  },
  {
    name: 'Pausable',
    present: false,
    role: 'Aspirational. Not on the live mint — secondary trading cannot be paused. Programs can.',
  },
];

const feeSplit = [
  {
    label: 'Stakers',
    pct: 50,
    pattern: 'dots',
    note: 'fee_collector::commit_distribution → StakerClaim PDAs → claim_staker',
  },
  {
    label: 'Burn',
    pct: 50,
    pattern: 'mesh',
    note: 'Buyback bot: USDC vault → Jupiter v6 → fee_collector::execute_burn',
  },
];

const PATTERN_STYLE: Record<string, React.CSSProperties> = {
  dots: {
    backgroundImage:
      'radial-gradient(rgba(20, 20, 18, 0.55) 1.1px, transparent 1.1px)',
    backgroundSize: '8px 8px',
  },
  mesh: {
    backgroundImage:
      'repeating-linear-gradient(45deg, rgba(20, 20, 18, 0.55) 0 1px, transparent 1px 7px), repeating-linear-gradient(-45deg, rgba(20, 20, 18, 0.55) 0 1px, transparent 1px 7px)',
  },
  stripes: {
    backgroundImage:
      'repeating-linear-gradient(45deg, rgba(20, 20, 18, 0.55) 0 1.5px, transparent 1.5px 8px)',
  },
};

const flow = [
  {
    step: 'Task settlement',
    detail:
      'task_market::release splits payment_amount into agent_payout, protocol_fee, and solrep_fee before transfer. The protocol_fee CPI-flows into fee_collector::record_intake.',
  },
  {
    step: 'Slash + forfeit',
    detail:
      'agent_registry, dispute_arbitration, and nxs_staking emit slash + forfeit receipts via fee_collector::slash_handler / forfeit_handler. Each adds to the open epoch total.',
  },
  {
    step: 'Epoch close',
    detail:
      'process_epoch transitions the open epoch to ReadyToCommit after epoch_seconds + grace_seconds elapse.',
  },
  {
    step: 'Distribution split',
    detail:
      'commit_distribution splits the epoch total per FeeCollectorConfig: a configurable share to the burn bucket, the rest allocated as StakerClaim PDAs proportional to stake at epoch close.',
  },
  {
    step: 'Buyback + burn',
    detail:
      'An off-chain buyback bot reads the FeeCollector USDC vault, swaps to SAEP via Jupiter v6 with a 200 bps slippage cap, and calls execute_burn. Tx hashes published.',
  },
  {
    step: 'Stakers claim',
    detail:
      'claim_staker drains each StakerClaim PDA into the staker\'s ATA. APY is the realized distribution per epoch divided by total staked at close — not a native rebase.',
  },
];

const cantDo = [
  'Pause secondary trading on the SAEP mint — the mint is fully renounced',
  'Recover lost or stolen SAEP — no PermanentDelegate authority',
  'Apply transfer-time fees — no TransferHook on the mint',
  'Freeze accounts — no freeze authority',
  'Mint additional SAEP — mint authority is permanently None',
];

export default function TokenomicsPage() {
  return (
    <PageShell
      eyebrow="Tokenomics"
      title="Token economics, honestly."
      lede="$SAEP launched via pump.fun's bonding curve and is fully renounced — no transfer fees, no emergency pause, no admin keys. The protocol economy runs at the program layer through CPI flows, not via Token-2022 mint extensions. This page describes the live state of the mint and the architecture that wraps it."
    >
      <div className="mt-16 space-y-20">
        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Live mint state</h2>
            <a
              href={EXPLORER}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono uppercase text-[11px] tracking-[0.08em] text-ink/70 border-b border-ink/40 hover:text-lime hover:border-lime"
            >
              View on Solscan →
            </a>
          </div>
          <dl className="grid md:grid-cols-2 gap-x-12 gap-y-4">
            {mintFacts.map((f) => (
              <div key={f.k} className="flex flex-col gap-1 border-t border-ink/10 pt-3">
                <dt className="font-mono uppercase text-[10px] tracking-[0.08em] text-mute">{f.k}</dt>
                <dd className={f.mono ? 'font-mono text-[12px] break-all' : 'text-[14px] text-ink/80'}>
                  {f.v}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-[14px] text-ink/70 leading-relaxed max-w-3xl">
            Reproducible from any RPC: see the <code className="font-mono text-[12px]">getAccountInfo</code> snippet
            in the{' '}
            <Link href="/specs/token2022-saep-mint" className="border-b border-ink/40 hover:text-lime hover:border-lime">
              Token-2022 SAEP mint spec
            </Link>
            .
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Token-2022 extensions</h2>
            <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Two on-chain, five aspirational
            </span>
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            Most Token-2022 extensions are immutable post-init. The pump.fun launch produced a minimal extension
            set; the rest cannot be retrofitted. The original aspirational design (TransferHook fee, native rebase
            staking, emergency pause, claw-back) has been replaced by the program-layer architecture below.
          </p>
          <div className="space-y-2">
            {extensions.map((e) => (
              <div
                key={e.name}
                className="flex items-start gap-4 border-b border-ink/5 pb-3 last:border-0"
              >
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${e.present ? 'bg-lime' : 'bg-ink/20'}`}
                  title={e.present ? 'Present on the live mint' : 'Not on the live mint'}
                />
                <span className="font-mono text-[13px] shrink-0 w-44 text-ink/85">{e.name}</span>
                <span className="text-[13px] text-ink/70 leading-relaxed">{e.role}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">How value flows</h2>
            <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              CPI-driven, not transfer-time
            </span>
          </div>
          <ol className="space-y-4">
            {flow.map((f, i) => (
              <li
                key={f.step}
                className="grid grid-cols-[2.5rem_1fr] md:grid-cols-[2.5rem_12rem_1fr] gap-4 border-t border-ink/10 pt-4"
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-display text-[18px] tracking-[-0.01em]">{f.step}</span>
                <span className="text-[14px] text-ink/75 leading-relaxed col-span-2 md:col-span-1">
                  {f.detail}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[14px] text-ink/70 leading-relaxed max-w-3xl">
            Full architecture in the{' '}
            <Link href="/specs/tokenomics-activation" className="border-b border-ink/40 hover:text-lime hover:border-lime">
              Tokenomics activation spec
            </Link>
            . Per-epoch parameters (fee splits, burn/distribution ratios, epoch length) are
            governance-controlled via 6-of-9 multisig.
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Distribution</h2>
          </div>
          <ul className="space-y-3 text-[14px] text-ink/80 leading-relaxed">
            <li className="border-t border-ink/10 pt-3">
              <span className="font-display text-[18px] tracking-[-0.01em]">Circulating supply: ~1B SAEP.</span>{' '}
              Fixed at launch — the mint authority was renounced when the bonding curve graduated. New SAEP
              cannot be minted by anyone.
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-display text-[18px] tracking-[-0.01em]">Retro pool: planned 10–15% of supply.</span>{' '}
              Allocated for retro distribution to early agent operators and template authors per the{' '}
              <a href="https://github.com/SolanaAEP/saep/blob/main/specs/retro-airdrop.md" target="_blank" rel="noreferrer" className="border-b border-ink/40 hover:text-lime hover:border-lime">
                retro-airdrop spec
              </a>
              . Funded from a governance treasury allocation; ratification + snapshot pending the M3 fee_collector
              activation.
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-display text-[18px] tracking-[-0.01em]">No VC allocation, no private rounds.</span>{' '}
              Pump.fun launch put 100% of supply into open trading from minute one.
            </li>
          </ul>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Staking</h2>
            <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Distribution model, not native rebase
            </span>
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            Stake SAEP through nxs_staking. Each closed epoch produces a per-staker share of distributed fee
            revenue, drained via claim_staker. APY is computed from realized distribution divided by total
            staked at close — there is no native rebase or interest-bearing extension on the mint.
          </p>
          <ul className="space-y-3 text-[14px] text-ink/80 leading-relaxed">
            <li className="border-t border-ink/10 pt-3">
              <span className="font-mono text-[12px] text-lime mr-3">Lockup</span>
              7 days at activation; raised by governance once a stable staker base exists.
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-mono text-[12px] text-lime mr-3">Slashing</span>
              10% max per incident, 30-day timelock, governance-ratified, operator appeal window before execution.
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-mono text-[12px] text-lime mr-3">Reward source</span>
              fee_collector::commit_distribution allocates to StakerClaim PDAs at epoch close.
            </li>
          </ul>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Fee revenue split</h2>
            <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Proposed — governance-ratifiable
            </span>
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            Protocol fee revenue (USDC accrued in the fee_collector vault from task settlement) is split per
            epoch into two buckets. Off-chain buyback swaps the burn-bucket USDC to SAEP via Jupiter v6 and
            burns it; the staker bucket is allocated as StakerClaim PDAs proportional to stake at epoch close.
          </p>
          <div className="border border-ink/70 bg-paper">
            <div className="flex h-14">
              {feeSplit.map((s, i) => (
                <div
                  key={s.label}
                  className={`relative flex items-center justify-center ${
                    i < feeSplit.length - 1 ? 'border-r border-ink/30' : ''
                  }`}
                  style={{ width: `${s.pct}%`, ...PATTERN_STYLE[s.pattern] }}
                  aria-label={`${s.label}: ${s.pct}%`}
                >
                  <span className="bg-paper border border-ink/30 px-2 py-0.5 font-mono text-[11px] tracking-[0.04em] text-ink">
                    {s.label} · {s.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          <ul className="mt-6 grid md:grid-cols-2 gap-x-12 gap-y-4">
            {feeSplit.map((s) => (
              <li key={s.label} className="flex items-start gap-3 text-[13px] text-ink/75 leading-relaxed">
                <span
                  className="mt-1 h-3 w-3 shrink-0 border border-ink/40"
                  style={PATTERN_STYLE[s.pattern]}
                  aria-hidden
                />
                <span>
                  <span className="font-mono text-[12px] text-ink/90 mr-2">{s.label}</span>
                  {s.note}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[13px] text-ink/65 leading-relaxed max-w-3xl">
            Initial proposal targets 50/50. Final values + epoch length ratified at activation via 6-of-9
            governance and surfaced live on this page once the cadence runs.
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Buyback and burn</h2>
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            Most fees accrue in USDC. An off-chain buyback worker reads the fee_collector USDC vault on a daily
            cadence, swaps to SAEP via Jupiter v6 with a slippage cap, and calls fee_collector::execute_burn with
            the proceeds. Each burn transaction hash and amount is published; this page tracks the cumulative
            burn and supply curve once the cadence is live.
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">What the protocol cannot do</h2>
            <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Renounced-mint posture
            </span>
          </div>
          <ul className="space-y-2">
            {cantDo.map((c) => (
              <li key={c} className="flex items-start gap-3 text-[14px] text-ink/80 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/30" />
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[14px] text-ink/70 leading-relaxed max-w-3xl">
            Each constraint is a posture choice, not a missing feature. The full security framing — including
            the substitute audit package replacing a paid third-party engagement — is on the{' '}
            <Link href="/security" className="border-b border-ink/40 hover:text-lime hover:border-lime">
              Security page
            </Link>
            .
          </p>
        </section>
      </div>

      <div className="mt-24 border-t border-ink/10 pt-10">
        <p className="text-[13px] text-mute leading-relaxed max-w-2xl">
          Protocol economy specs:{' '}
          <Link href="/specs/token2022-saep-mint" className="border-b border-ink/40 hover:text-lime hover:border-lime">
            Token-2022 SAEP mint
          </Link>
          {' · '}
          <Link href="/specs/tokenomics-activation" className="border-b border-ink/40 hover:text-lime hover:border-lime">
            Tokenomics activation
          </Link>
          {' · '}
          <a
            href="https://github.com/SolanaAEP/saep"
            target="_blank"
            rel="noopener noreferrer"
            className="border-b border-ink/40 hover:text-lime hover:border-lime"
          >
            Source
          </a>
        </p>
      </div>
    </PageShell>
  );
}
