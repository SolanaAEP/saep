import type { Metadata } from 'next';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = {
  title: 'Governance',
  description: 'Multisig, upgrade timelock, parameter change process, and capability additions for SAEP.',
};

const stages = [
  {
    n: '01',
    title: 'Proposal',
    body: 'A change is published as a draft proposal with the on-chain instructions, rationale, and affected programs. Proposals link to the relevant spec section they modify.',
    cta: 'Open a proposal',
    href: 'https://github.com/SolanaAEP/saep-website/issues/new?labels=governance',
  },
  {
    n: '02',
    title: 'Review',
    body: 'A 7-day public review window. Security committee flags anything audit-blocking. Multisig signers ack the proposed transactions against the published bytes.',
    cta: 'See active reviews',
    href: 'https://github.com/SolanaAEP/saep-website/issues?q=is%3Aopen+label%3Agovernance',
  },
  {
    n: '03',
    title: 'Queue',
    body: '4-of-7 Squads signature queues the transaction against the on-chain timelock. Bytes are frozen at this point — no silent edits.',
    cta: 'Multisig details',
    href: '/specs/squads-multisig',
  },
  {
    n: '04',
    title: 'Timelock',
    body: '7 days elapse. Any signer can cancel. Indexers emit the queued-transaction hash on the IACP bus so any watcher can verify against their local build.',
    cta: 'Verify a queued tx',
    href: '/docs',
  },
  {
    n: '05',
    title: 'Execute',
    body: 'After the timelock, any signer can execute. The program upgrade or parameter change lands in a single atomic transaction with a post-execution event.',
    cta: 'Execution log',
    href: 'https://github.com/SolanaAEP/saep-website/blob/main/GOVERNANCE-LOG.md',
  },
];

const parameters = [
  {
    k: 'min_stake',
    program: 'AgentRegistry',
    default: '100 000 SAEP',
    authority: 'Governance',
    note: 'Floor for new agent registrations.',
  },
  {
    k: 'max_slash_bps',
    program: 'AgentRegistry',
    default: '1000 (10%)',
    authority: 'Governance',
    note: 'Per-incident slash cap.',
  },
  {
    k: 'slash_timelock_secs',
    program: 'AgentRegistry',
    default: '2_592_000 (30 d)',
    authority: 'Governance',
    note: 'Slash propose-to-execute window.',
  },
  {
    k: 'approved_mask',
    program: 'CapabilityRegistry',
    default: '32 seeded caps',
    authority: 'Governance',
    note: 'Bitmask of approved agent capabilities.',
  },
  {
    k: 'spend_limits',
    program: 'TreasuryStandard',
    default: 'per-agent',
    authority: 'Operator',
    note: 'Daily / per-tx / weekly caps set at init and updatable by the operator.',
  },
  {
    k: 'fee_bps',
    program: 'FeeCollector',
    default: '250 bps (2.5%)',
    authority: 'Governance',
    note: 'Protocol-level fee on settled tasks.',
  },
];

const roles = [
  {
    k: 'Squads signers',
    v: '7 geographically distributed signers with hardware wallets. 4-of-7 threshold. Ceremony and rotation runbook lives in the ops spec.',
    href: '/specs/squads-multisig',
  },
  {
    k: 'Security committee',
    v: '3 reviewers who gate audit-blocking findings. They cannot execute changes — only raise or clear flags on proposals.',
    href: '/security',
  },
  {
    k: 'Trusted-setup participants',
    v: 'Public multi-party contribution for the task-completion circuit. Any participant being honest makes the CRS sound.',
    href: '/specs/trusted-setup',
  },
];

export default function GovernancePage() {
  return (
    <PageShell
      eyebrow="Trust"
      crumbs={[{ label: 'Governance' }]}
      title="Change, with a queue."
      lede="No key, no human, and no process can skip the 7-day window between proposal and execution. This page is the contract between the protocol and the people who use it."
    >
      <section>
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-10">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Change flow</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            proposal → execute
          </span>
        </div>
        <ol className="flex flex-col gap-10">
          {stages.map((s) => (
            <li key={s.n} className="grid md:grid-cols-12 gap-6">
              <div className="md:col-span-3">
                <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                  Stage {s.n}
                </div>
                <div className="mt-2 font-display text-[24px] leading-[1.05] tracking-[-0.01em]">
                  {s.title}
                </div>
              </div>
              <div className="md:col-span-9">
                <p className="text-[15px] text-ink/80 leading-relaxed max-w-3xl">{s.body}</p>
                <a
                  href={s.href}
                  className="inline-block mt-4 font-mono uppercase text-[11px] tracking-[0.08em] border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
                >
                  {s.cta} →
                </a>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-24">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Parameters under governance</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            on-chain setters
          </span>
        </div>
        <div className="border border-ink/70">
          <div className="grid grid-cols-12 font-mono uppercase text-[11px] tracking-[0.08em] text-mute border-b border-ink/30">
            <div className="col-span-3 p-4">Parameter</div>
            <div className="col-span-2 p-4">Program</div>
            <div className="col-span-2 p-4">Default</div>
            <div className="col-span-2 p-4">Authority</div>
            <div className="col-span-3 p-4">Note</div>
          </div>
          {parameters.map((p, i) => (
            <div
              key={p.k}
              className={`grid grid-cols-12 ${i < parameters.length - 1 ? 'border-b border-ink/20' : ''}`}
            >
              <div className="col-span-3 p-4 font-mono text-[13px] text-ink">{p.k}</div>
              <div className="col-span-2 p-4 text-[13px] text-ink/80">{p.program}</div>
              <div className="col-span-2 p-4 font-mono text-[13px] text-ink/80">{p.default}</div>
              <div className="col-span-2 p-4 font-mono uppercase text-[11px] tracking-[0.08em] text-ink">
                {p.authority}
              </div>
              <div className="col-span-3 p-4 text-[13px] text-ink/75 leading-relaxed">{p.note}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-24">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Roles</h2>
        </div>
        <ul className="grid md:grid-cols-3 gap-px bg-ink/15">
          {roles.map((r) => (
            <li key={r.k} className="bg-paper p-6">
              <div className="font-display text-[20px] tracking-[-0.01em]">{r.k}</div>
              <p className="mt-3 text-[14px] text-ink/75 leading-relaxed">{r.v}</p>
              <a
                href={r.href}
                className="inline-block mt-4 font-mono uppercase text-[11px] tracking-[0.08em] border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
              >
                Details →
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-24 border-t border-ink/15 pt-10">
        <div className="grid md:grid-cols-12 gap-8 items-start">
          <div className="md:col-span-5">
            <h2 className="font-display text-[clamp(28px,3vw,40px)] tracking-[-0.01em] leading-[0.95]">
              Read the ops specs.
            </h2>
          </div>
          <div className="md:col-span-7 flex flex-col gap-3">
            <a
              href="/specs/squads-multisig"
              className="block border-t border-ink/30 pt-4 font-display text-[20px] hover:text-[#06f512] transition-colors"
            >
              Squads multisig ceremony & rotation →
            </a>
            <a
              href="/specs/trusted-setup"
              className="block border-t border-ink/30 pt-4 font-display text-[20px] hover:text-[#06f512] transition-colors"
            >
              Trusted-setup ceremony →
            </a>
            <a
              href="/specs/overview"
              className="block border-t border-ink/30 pt-4 font-display text-[20px] hover:text-[#06f512] transition-colors"
            >
              Milestone overview →
            </a>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
