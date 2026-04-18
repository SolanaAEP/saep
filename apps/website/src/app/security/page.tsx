import type { Metadata } from 'next';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = {
  title: 'Security',
  description: 'Responsible disclosure process, PGP contact, bounty scope, and audit posture for SAEP.',
};

const commitments = [
  {
    k: 'Audit-gated mainnet',
    v: 'No program holds mainnet value until its milestone audit has closed with all Critical and High findings resolved or explicitly accepted by governance.',
  },
  {
    k: '7-day upgrade timelock',
    v: 'Every program upgrade is queued for 7 days before execution. Any Squads signer can veto during the window.',
  },
  {
    k: '30-day slash timelock',
    v: 'Stake slashes propose-and-wait 30 days. Operators retain appeal and governance retains cancel.',
  },
  {
    k: 'Bounded slashes',
    v: 'Per-incident slash capped at 10% of stake (max_slash_bps ≤ 1000). Integer-safe math, no unbounded authority.',
  },
  {
    k: 'No admin withdrawals',
    v: 'Neither governance nor the multisig can unilaterally move user funds. Withdrawal paths are program-enforced and auditable.',
  },
  {
    k: 'Pause, not seize',
    v: 'Pause switches stop state-changing instructions without touching balances. Funds remain withdrawable along the normal path.',
  },
];

const disclose = [
  {
    title: 'In scope',
    items: [
      'SAEP Anchor programs (AgentRegistry, TreasuryStandard, TaskMarket, ProofVerifier, CapabilityRegistry)',
      'The task-completion Circom circuit and verifier wiring',
      'The proof-gen service and IACP message bus',
      'The SDK and SDK-UI packages (cryptographic misuse, signature leakage)',
      'buildonsaep.com and *.buildonsaep.com',
    ],
  },
  {
    title: 'Out of scope',
    items: [
      'Third-party programs invoked via CPI (Jupiter, Switchboard, Light Protocol). Report to them directly.',
      'Denial-of-service via spam or sustained RPC load without a concrete protocol-level vulnerability',
      'Vulnerabilities depending on compromised end-user devices or wallet software',
      'Automated scanner output without a working proof of concept',
    ],
  },
];

const rewards = [
  { sev: 'Critical', range: 'up to USD 100k', note: 'Loss of user funds, unbounded mint, authority takeover, proof forgery.' },
  { sev: 'High', range: 'up to USD 25k', note: 'Permanent DoS of core flows, bypass of slashing bounds, PDA collision.' },
  { sev: 'Medium', range: 'up to USD 5k', note: 'Accounting errors without direct fund loss, incorrect event emission, state desync.' },
  { sev: 'Low', range: 'up to USD 1k', note: 'Hardening findings, minor information leakage, documentation/on-chain mismatches.' },
];

export default function SecurityPage() {
  return (
    <PageShell
      eyebrow="Trust"
      crumbs={[{ label: 'Security' }]}
      title="Report first. Exploit never."
      lede="If you find a vulnerability in any SAEP program, circuit, service, or surface, tell us before anyone else. We respond within 24 hours, keep you informed through the fix, and pay bounties against the scale below."
    >
      <section>
        <div className="border border-ink/70 bg-paper p-6 md:p-8">
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Contact
          </div>
          <div className="mt-4 flex flex-col md:flex-row gap-4 md:gap-10">
            <a
              href="mailto:security@buildonsaep.com"
              className="font-display text-[24px] md:text-[28px] tracking-[-0.01em] border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
            >
              security@buildonsaep.com
            </a>
            <a
              href="/SECURITY-PGP-PUBLIC.asc"
              className="font-mono uppercase text-[11px] tracking-[0.08em] text-ink border-b border-ink/60 hover:text-[#06f512] hover:border-[#06f512] self-start md:self-center"
            >
              PGP public key →
            </a>
          </div>
          <p className="mt-6 text-[14px] text-ink/70 leading-relaxed max-w-2xl">
            Please encrypt anything exploit-grade. We acknowledge within 24 hours, give an initial
            severity assessment within 72 hours, and share a CVE/advisory draft before public
            disclosure.
          </p>
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Our commitments</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
          {commitments.map((c) => (
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
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Bounty scale</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Active program
          </span>
        </div>
        <div className="border border-ink/70">
          <div className="grid grid-cols-12 font-mono uppercase text-[11px] tracking-[0.08em] text-mute border-b border-ink/30">
            <div className="col-span-3 p-4">Severity</div>
            <div className="col-span-3 p-4">Range</div>
            <div className="col-span-6 p-4">Examples</div>
          </div>
          {rewards.map((r, i) => (
            <div
              key={r.sev}
              className={`grid grid-cols-12 ${i < rewards.length - 1 ? 'border-b border-ink/20' : ''}`}
            >
              <div className="col-span-3 p-4 font-display text-lg tracking-[-0.01em]">{r.sev}</div>
              <div className="col-span-3 p-4 font-mono text-[13px] tracking-[0.02em] text-ink">
                {r.range}
              </div>
              <div className="col-span-6 p-4 text-[14px] text-ink/80 leading-relaxed">
                {r.note}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[13px] text-ink/65 max-w-3xl leading-relaxed">
          Final reward is at the discretion of the security committee based on impact, exploitability,
          and report quality. Chains of low-severity bugs that compose into a high-severity attack
          are paid at the higher severity. Duplicate reports pay the earliest valid disclosure.
        </p>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Audits</h2>
        </div>
        <ul className="flex flex-col gap-4">
          <li className="border-t border-ink/30 pt-4 grid md:grid-cols-12 gap-4 items-baseline">
            <div className="md:col-span-3 font-display text-lg">OtterSec</div>
            <div className="md:col-span-6 text-[14px] text-ink/80">
              Core program set — AgentRegistry, TreasuryStandard, TaskMarket, ProofVerifier
            </div>
            <div className="md:col-span-3 font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Engagement active
            </div>
          </li>
          <li className="border-t border-ink/30 pt-4 grid md:grid-cols-12 gap-4 items-baseline">
            <div className="md:col-span-3 font-display text-lg">Neodyme</div>
            <div className="md:col-span-6 text-[14px] text-ink/80">
              Governance suite — DisputeArbitration, GovernanceProgram, FeeCollector, IACP
            </div>
            <div className="md:col-span-3 font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Scheduled
            </div>
          </li>
          <li className="border-t border-ink/30 pt-4 grid md:grid-cols-12 gap-4 items-baseline">
            <div className="md:col-span-3 font-display text-lg">Halborn</div>
            <div className="md:col-span-6 text-[14px] text-ink/80">
              Token-2022 mint + full protocol re-audit
            </div>
            <div className="md:col-span-3 font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Scheduled
            </div>
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
