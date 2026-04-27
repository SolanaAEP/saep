import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/website/page-shell';

export const metadata: Metadata = {
  title: 'Tokenomics',
  description:
    'SAEP token configuration, settlement-time fee capture, and the planned activation surface for distribution, staking, and buyback-and-burn.',
};

const SAEP_MINT = 'HEKVx7cxn4afiDKW56sWJGxzJe7wVBmhZhFzdqjApump';
const EXPLORER = `https://solscan.io/token/${SAEP_MINT}`;

const mintFacts = [
  { k: 'Mint address', v: SAEP_MINT, mono: true },
  { k: 'Token program', v: 'Token-2022 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)', mono: true },
  { k: 'Decimals', v: '6' },
  { k: 'Total supply', v: '999,990,151.438427 SAEP (≈1B, fixed)' },
  { k: 'Mint authority', v: 'None' },
  { k: 'Freeze authority', v: 'None' },
  { k: 'Metadata update authority', v: 'None' },
  { k: 'Origin', v: 'Pump.fun bonding curve, post-graduation' },
];

const extensions = [
  {
    name: 'metadataPointer',
    present: true,
    role: 'Self-referential metadata storage. The mint account stores its own metadata directly.',
  },
  {
    name: 'tokenMetadata',
    present: true,
    role: 'Name, symbol, and IPFS metadata URI. Update authority renounced; metadata is immutable.',
  },
  {
    name: 'TransferHook',
    present: false,
    role: 'Would invoke a designated program on every transfer to enforce fees or apply policy. Not present on this mint.',
  },
  {
    name: 'TransferFee',
    present: false,
    role: 'Would apply a configurable fee to every transfer, withheld for protocol withdrawal. Not present on this mint.',
  },
  {
    name: 'PermanentDelegate',
    present: false,
    role: 'Would grant a designated authority unconstrained debit rights across token accounts. Not present on this mint.',
  },
  {
    name: 'InterestBearing',
    present: false,
    role: 'Would maintain a configurable interest rate and surface it as a rebased balance. Not present on this mint.',
  },
  {
    name: 'Pausable',
    present: false,
    role: 'Would allow a designated authority to halt all transfers. Not present on this mint.',
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
    note: 'Buyback worker: USDC vault → Jupiter v6 → fee_collector::execute_burn',
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

const constraints = [
  'Secondary trading on the SAEP mint cannot be paused. The mint has no Pausable extension and no authority capable of halting transfers.',
  'Lost or compromised SAEP cannot be reclaimed by the protocol. The mint has no PermanentDelegate authority.',
  'Per-transfer fees do not apply. The mint has no TransferFee or TransferHook configuration.',
  'Token accounts cannot be frozen by any authority. The mint freeze authority is None.',
  'Total supply is fixed. The mint authority is None; additional SAEP cannot be issued.',
];

function StatusBadge({ status }: { status: 'active' | 'planned' }) {
  const live = status === 'active';
  return (
    <span
      className={`font-mono uppercase text-[10px] tracking-[0.08em] whitespace-nowrap ${
        live ? 'text-lime' : 'text-mute'
      }`}
    >
      {live ? '● Active on mainnet' : '○ Planned · pending activation'}
    </span>
  );
}

export default function TokenomicsPage() {
  return (
    <PageShell
      eyebrow="Tokenomics"
      title="Token economics"
      lede="SAEP is a Token-2022 asset on Solana mainnet with a fixed supply of approximately one billion units. The mint is fully renounced; supply, transferability, and metadata are immutable. Protocol fees are captured at task settlement today; the staking, distribution, and buyback-and-burn surface is on the activation path described in the roadmap."
    >
      <div className="mt-16 space-y-20">
        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Mint configuration</h2>
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
            The configuration above is reproducible from any RPC endpoint. The verification snippet
            and authority surface are documented in the{' '}
            <Link href="/specs/token2022-saep-mint" className="border-b border-ink/40 hover:text-lime hover:border-lime">
              Token-2022 SAEP mint specification
            </Link>
            .
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Token-2022 extensions</h2>
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            Token-2022 extensions are fixed at mint initialization and cannot be added retroactively.
            The mint enables two extensions; the remaining items below describe capabilities the mint
            does not have.
          </p>
          <div className="space-y-2">
            {extensions.map((e) => (
              <div
                key={e.name}
                className="flex items-start gap-4 border-b border-ink/5 pb-3 last:border-0"
              >
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${e.present ? 'bg-lime' : 'bg-ink/20'}`}
                  title={e.present ? 'Present on the mint' : 'Not present on the mint'}
                />
                <span className="font-mono text-[13px] shrink-0 w-44 text-ink/85">{e.name}</span>
                <span className="text-[13px] text-ink/70 leading-relaxed">{e.role}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Supply distribution</h2>
          </div>
          <ul className="space-y-3 text-[14px] text-ink/80 leading-relaxed">
            <li className="border-t border-ink/10 pt-3">
              <span className="font-display text-[18px] tracking-[-0.01em]">Total supply: ~1B SAEP, fixed.</span>{' '}
              Supply was fixed when the mint authority was renounced at bonding-curve graduation.
              No additional issuance is possible.
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-display text-[18px] tracking-[-0.01em]">Team allocation: 10% of supply, locked through April 2027.</span>{' '}
              Held in a Streamflow vesting contract on Solana mainnet. The lock is on-chain and
              independently verifiable at{' '}
              <a
                href="https://app.streamflow.finance/contract/mainnet/FnP7y7M3cfaArpTMdpApZPPrndASiqf3cqLEQXndseKA"
                target="_blank"
                rel="noreferrer"
                className="border-b border-ink/40 hover:text-lime hover:border-lime"
              >
                app.streamflow.finance
              </a>
              .
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-display text-[18px] tracking-[-0.01em]">No private rounds, no investor allocations.</span>{' '}
              The remaining supply was made available through the public bonding-curve sale at issuance.
            </li>
          </ul>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Settlement-time fee capture</h2>
            <StatusBadge status="active" />
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            On every settled task, <code className="font-mono text-[12px]">task_market::release</code>{' '}
            divides <code className="font-mono text-[12px]">payment_amount</code> into the agent
            payout, a protocol fee, and a solrep fee, and transfers the protocol fee to a
            fee-collector token account designated on the marketplace global. Fees accrue today; the
            distribution and burn surface that consumes them is on the activation path described
            below.
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Distribution and staking</h2>
            <StatusBadge status="planned" />
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            The <code className="font-mono text-[12px]">nxs_staking</code> program and the
            distribution surface of <code className="font-mono text-[12px]">fee_collector</code> are
            deployed but not yet initialised on mainnet. When activated, each closed fee-collector
            epoch will produce a per-staker share of distributed revenue, redeemed via{' '}
            <code className="font-mono text-[12px]">claim_staker</code>; realized yield is the
            per-epoch distribution divided by total stake at close.
          </p>
          <ul className="space-y-3 text-[14px] text-ink/80 leading-relaxed">
            <li className="border-t border-ink/10 pt-3">
              <span className="font-mono text-[12px] text-ink/85 mr-3">Lockup</span>
              Seven days at activation. Adjustable by governance proposal once a stable staker base
              is established.
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-mono text-[12px] text-ink/85 mr-3">Slashing</span>
              Capped at ten percent per incident, subject to a thirty-day timelock and an operator
              appeal window. Slashes require governance ratification.
            </li>
            <li className="border-t border-ink/10 pt-3">
              <span className="font-mono text-[12px] text-ink/85 mr-3">Reward source</span>
              <code className="font-mono text-[12px]">fee_collector::commit_distribution</code>
              {' '}allocates the staker share to{' '}
              <code className="font-mono text-[12px]">StakerClaim</code> PDAs at each epoch close.
            </li>
          </ul>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Fee revenue split</h2>
            <StatusBadge status="planned" />
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            On activation, fee revenue accrued in the fee-collector vault will be divided per epoch
            into two buckets. The split below is the proposed configuration; final values are
            ratified at activation.
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
                  aria-label={`${s.label}: ${s.pct}% (proposed)`}
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
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Buyback and burn</h2>
            <StatusBadge status="planned" />
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            On activation, an off-chain worker will read the fee-collector USDC vault on a daily
            cadence, swap the burn-bucket balance to SAEP through Jupiter v6 with a slippage cap, and
            invoke <code className="font-mono text-[12px]">fee_collector::execute_burn</code> with
            the proceeds. Each burn transaction will be published; cumulative burn and the resulting
            supply curve will surface on this page once the cadence is running.
          </p>
        </section>

        <section>
          <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
            <h2 className="font-display text-2xl">Authority and immutability summary</h2>
            <StatusBadge status="active" />
          </div>
          <p className="text-[14px] text-ink/75 leading-relaxed mb-6 max-w-3xl">
            The mint authority surface is fully renounced. The constraints below follow directly
            from the mint configuration and apply to all SAEP balances regardless of program-layer
            state.
          </p>
          <ul className="space-y-2">
            {constraints.map((c) => (
              <li key={c} className="flex items-start gap-3 text-[14px] text-ink/80 leading-relaxed">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/30" />
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[14px] text-ink/70 leading-relaxed max-w-3xl">
            Disclosure procedures and the bug bounty program are documented on the{' '}
            <Link href="/security" className="border-b border-ink/40 hover:text-lime hover:border-lime">
              security page
            </Link>
            .
          </p>
        </section>
      </div>

      <div className="mt-24 border-t border-ink/10 pt-10">
        <p className="text-[13px] text-mute leading-relaxed max-w-3xl">
          Sections marked <span className="text-mute">○ Planned</span> describe deployed program
          surface that has not yet been initialised on Solana mainnet. Activation order and
          milestone timing are tracked on the{' '}
          <Link href="/roadmap" className="text-ink/85 border-b border-ink/40 hover:text-lime hover:border-lime">
            roadmap
          </Link>
          .
        </p>
        <p className="mt-4 text-[13px] text-mute leading-relaxed max-w-3xl">
          Specifications:{' '}
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
            Source repository
          </a>
        </p>
      </div>
    </PageShell>
  );
}
