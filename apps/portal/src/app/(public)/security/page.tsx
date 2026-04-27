import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'SAEP vulnerability disclosure, bounty program, on-chain controls, authority surface, and review status.',
};

const enforced = [
  {
    k: 'Fixed supply',
    v: 'The SAEP mint authority is None. Total supply was fixed at bonding-curve graduation; additional issuance is not possible.',
  },
  {
    k: 'Bounded slashing',
    v: 'In the deployed agent_registry program, per-incident slash is capped at ten percent of stake and subject to a thirty-day timelock with an operator appeal window. Slashing arithmetic is integer-safe and bounded.',
  },
  {
    k: 'No administrative withdrawals',
    v: 'No instruction in the deployed program set permits an authority to unilaterally move user funds. Withdrawal paths are program-enforced and limited to the originating depositor.',
  },
  {
    k: 'Reentrancy guards',
    v: 'A ReentrancyGuard PDA is enforced across all state-changing programs. Cross-program invocation depth is capped via get_stack_height; allowed-callers PDAs gate cross-program entry.',
  },
  {
    k: 'Commit-reveal bidding',
    v: 'Bids progress through commit and reveal phases with bond escrow. Failure to reveal forfeits the bond, blocking last-look sniping and bid-shading collusion.',
  },
  {
    k: 'Typed task schema',
    v: 'task_market accepts only a discriminated TaskKind payload with length-capped criteria. Free-form task descriptions cannot be used to smuggle policy past the on-chain state machine.',
  },
];

const planned = [
  {
    k: 'Personhood gate (high-value capability tiers)',
    v: 'Civic personhood attestation will be required at bid time for high-value capability tiers. Gate enforcement activates with the capability_registry minimum-tier proposal.',
  },
  {
    k: 'Program-level emergency pause',
    v: 'Pause hooks on fee_collector, task_market, and treasury_standard halt state-changing instructions without affecting balances. The pause-authority surface activates as part of the governance multisig configuration.',
  },
  {
    k: 'Token-2022 hook allowlist',
    v: 'fee_collector::HookAllowlist will reject unknown transfer-hook programs on payment mints. Activates with fee_collector initialisation.',
  },
  {
    k: 'Upgrade timelock',
    v: 'Program upgrade authority will be migrated to a Squads multisig with a seven-day execution timelock. Any signer may veto during the window.',
  },
];

const constraints = [
  {
    k: 'Secondary trading on the SAEP mint cannot be paused',
    v: 'The mint has no Pausable extension. No authority is capable of halting transfers; secondary trading continues during any program-level incident response.',
  },
  {
    k: 'Lost or compromised SAEP cannot be reclaimed',
    v: 'The mint has no PermanentDelegate authority. Wallet compromise, phishing, and key loss are unrecoverable for the holder.',
  },
  {
    k: 'Per-transfer fees do not apply',
    v: 'The mint has no TransferHook or TransferFee configuration. Protocol revenue is captured at task settlement, not on every transfer.',
  },
  {
    k: 'Token accounts cannot be frozen',
    v: 'The mint freeze authority is None. No selective access control over individual token accounts is possible.',
  },
  {
    k: 'Independent third-party audit',
    v: 'A formal external audit has not been commissioned at this time. The review-and-disclosure components below are designed to provide equivalent assurance.',
  },
];

const disclose = [
  {
    title: 'In scope',
    items: [
      'All ten Anchor programs: agent_registry, capability_registry, treasury_standard, task_market, proof_verifier, dispute_arbitration, governance_program, fee_collector, nxs_staking, template_registry',
      'The task-completion and unique-execution Circom circuits and on-chain verifier',
      'Off-chain services: indexer, discovery (including webhook delivery), proof-gen, IACP message bus, x402 gateway, MCP bridge, compute broker',
      'TypeScript SDK, sdk-ui hooks, and the Solana Agent Kit plugin (cryptographic misuse, signature handling, replay)',
      'buildonsaep.com and *.buildonsaep.com',
    ],
  },
  {
    title: 'Out of scope',
    items: [
      'Third-party programs invoked through cross-program calls (Jupiter, Switchboard, Light Protocol). Report directly to the upstream maintainers.',
      'The pump.fun bonding-curve program and pump.fun infrastructure. Mint-level findings are upstream issues; SAEP does not control the mint configuration.',
      'Denial of service via traffic volume without a concrete protocol-level vulnerability.',
      'Findings dependent on a compromised end-user device or wallet client.',
      'Automated scanner output without a working proof of concept.',
    ],
  },
];

const rewards = [
  { sev: 'Critical', range: 'up to USD 100,000', note: 'Loss of user funds, unbounded mint, authority takeover, proof forgery.' },
  { sev: 'High', range: 'up to USD 25,000', note: 'Permanent denial of service in core flows, slashing-bound bypass, PDA collision.' },
  { sev: 'Medium', range: 'up to USD 5,000', note: 'Accounting errors without direct fund loss, incorrect event emission, state desynchronization.' },
  { sev: 'Low', range: 'up to USD 1,000', note: 'Hardening findings, minor information leakage, documentation-to-implementation mismatches.' },
];

const review = [
  {
    k: 'Internal security review',
    v: 'Per-program audit reports for the M1 program set, a finding ledger across the security pass, fuzz harnesses, and compute-unit measurements are consolidated into a public security review document.',
    status: 'Publishing soon',
  },
  {
    k: 'Bug bounty program',
    v: 'Public scope, severity matrix, payout ranges, and safe-harbor terms are documented in a forthcoming bounty program. The pool is funded by an on-chain split of fee_collector revenue.',
    status: 'Publishing soon',
  },
  {
    k: 'Conservative on-chain caps',
    v: 'Per-task escrow ceilings and capability-tier requirements are configured conservatively at activation. Caps are raised only after sustained runtime without incident or following external review.',
    status: 'Activating with fee_collector init',
  },
  {
    k: 'External review outreach',
    v: 'Direct outreach to security firms with established Solana protocol practices. Positive responses escalate to a formal engagement.',
    status: 'In progress',
  },
  {
    k: 'Solana Foundation security grant',
    v: 'Grant application targeting protocol audit funding through the Solana Foundation security track.',
    status: 'Drafted',
  },
];

export default function SecurityPage() {
  return (
    <PageShell
      eyebrow="Trust"
      crumbs={[{ label: 'Security' }]}
      title="Security"
      lede="SAEP operates a coordinated vulnerability disclosure program. Reports submitted through the channels below receive an acknowledgement within twenty-four hours and an initial severity assessment within seventy-two. A bounty program with structured payout ranges is documented in the forthcoming bounty schedule; the pool is funded by an on-chain split of fee_collector revenue and activates with the corresponding milestone. The sections that follow document the controls currently active on mainnet, controls planned to activate during the milestone rollout, the authority surface of the SAEP mint, and the review components that constitute the protocol's external-assurance surface."
    >
      <section>
        <div className="border border-ink/70 bg-paper p-6 md:p-8">
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Disclosure channels
          </div>
          <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-10">
            <a
              href="mailto:security@buildonsaep.com"
              className="font-display text-[24px] md:text-[28px] tracking-[-0.01em] border-b border-ink hover:text-lime hover:border-lime"
            >
              security@buildonsaep.com
            </a>
            <a
              href="/SECURITY-PGP-PUBLIC.asc"
              className="font-mono uppercase text-[11px] tracking-[0.08em] text-ink border-b border-ink/60 hover:text-lime hover:border-lime self-start md:self-center"
            >
              PGP public key →
            </a>
            <a
              href="https://github.com/SolanaAEP/saep/security/advisories/new"
              target="_blank"
              rel="noreferrer"
              className="font-mono uppercase text-[11px] tracking-[0.08em] text-ink border-b border-ink/60 hover:text-lime hover:border-lime self-start md:self-center"
            >
              GitHub private advisory →
            </a>
          </div>
          <p className="mt-6 text-[14px] text-ink/70 leading-relaxed max-w-2xl">
            Encrypt exploit-grade material before transmission. Initial acknowledgement within
            twenty-four hours, severity assessment within seventy-two, and an advisory draft prior
            to public disclosure.
          </p>
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Review and assurance</h2>
        </div>
        <p className="max-w-3xl text-[14px] text-ink/75 leading-relaxed mb-8">
          The protocol's review-and-disclosure surface comprises five components. A formal external
          audit has not been commissioned at this time; the components below are designed to
          provide equivalent assurance and to remain in place alongside any future engagement.
        </p>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
          {review.map((s) => (
            <div key={s.k} className="border-t border-ink/30 pt-5">
              <div className="flex items-baseline justify-between gap-4">
                <div className="font-display text-[20px] tracking-[-0.01em]">{s.k}</div>
                <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-lime/80 whitespace-nowrap">
                  {s.status}
                </span>
              </div>
              <p className="mt-2 text-[14px] text-ink/75 leading-relaxed">{s.v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Protocol controls</h2>
          <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-lime">
            ● Active on mainnet
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
          {enforced.map((c) => (
            <div key={c.k} className="border-t border-ink/30 pt-5">
              <div className="font-display text-[20px] tracking-[-0.01em]">{c.k}</div>
              <p className="mt-2 text-[14px] text-ink/75 leading-relaxed">{c.v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Controls activating with the milestone rollout</h2>
          <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-mute">
            ○ Planned · pending activation
          </span>
        </div>
        <p className="max-w-3xl text-[14px] text-ink/75 leading-relaxed mb-8">
          The deployed program set includes additional controls that activate when the corresponding
          configuration is initialised on mainnet. Activation order is tracked on the{' '}
          <a href="/roadmap" className="border-b border-ink/40 hover:text-lime hover:border-lime">
            roadmap
          </a>
          .
        </p>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
          {planned.map((c) => (
            <div key={c.k} className="border-t border-ink/30 pt-5">
              <div className="font-display text-[20px] tracking-[-0.01em]">{c.k}</div>
              <p className="mt-2 text-[14px] text-ink/75 leading-relaxed">{c.v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Authority and constraint surface</h2>
        </div>
        <p className="max-w-3xl text-[14px] text-ink/75 leading-relaxed mb-8">
          The SAEP mint is fully renounced. The constraints below follow from the mint configuration
          and apply to all SAEP balances regardless of program-layer state.
        </p>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
          {constraints.map((c) => (
            <div key={c.k} className="border-t border-ink/30 pt-5">
              <div className="font-display text-[20px] tracking-[-0.01em]">{c.k}</div>
              <p className="mt-2 text-[14px] text-ink/75 leading-relaxed">{c.v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Disclosure scope</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-10">
          {disclose.map((d) => (
            <div key={d.title}>
              <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                {d.title}
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {d.items.map((i) => (
                  <li key={i} className="text-[14px] text-ink/80 leading-relaxed">
                    — {i}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Bounty schedule</h2>
          <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-mute">
            ○ Proposed · pool activates with fee_collector
          </span>
        </div>
        <p className="max-w-3xl text-[14px] text-ink/75 leading-relaxed mb-6">
          The schedule below is the proposed payout structure. The pool is funded by an on-chain
          split of fee_collector revenue and activates with the fee_collector milestone. Full terms
          will be published in the forthcoming bounty schedule.
        </p>
        <div className="border border-ink/70">
          {rewards.map((r, i) => (
            <div
              key={r.sev}
              className={`flex flex-col md:grid md:grid-cols-12 ${i < rewards.length - 1 ? 'border-b border-ink/20' : ''}`}
            >
              <div className="md:col-span-3 px-4 pt-4 md:py-4 font-display text-lg tracking-[-0.01em]">{r.sev}</div>
              <div className="md:col-span-3 px-4 py-1 md:py-4 font-mono text-[13px] tracking-[0.02em] text-ink">
                {r.range}
              </div>
              <div className="md:col-span-6 px-4 pb-4 md:py-4 text-[14px] text-ink/80 leading-relaxed">
                {r.note}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[13px] text-ink/65 max-w-3xl leading-relaxed">
          Final reward is determined by the security committee on the basis of impact, exploitability,
          and report quality. Chains of low-severity findings that compose into a high-severity attack
          are paid at the higher severity. Duplicate reports are paid to the earliest valid disclosure.
          Pool size and the full payout policy are ratified in the bounty program document.
        </p>
      </section>
    </PageShell>
  );
}
