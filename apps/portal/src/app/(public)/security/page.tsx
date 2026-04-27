import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'SAEP security posture: substitute audit package, on-chain safeguards, what the protocol cannot do, responsible disclosure flow, and bounty scale.',
};

const enforced = [
  {
    k: 'No mint inflation',
    v: 'The SAEP token mint authority is permanently None. Supply is fixed at the post-launch value; new SAEP cannot be minted by anyone.',
  },
  {
    k: '30-day slash timelock',
    v: 'Stake slashes propose-and-wait 30 days. Operators retain appeal; governance retains cancel.',
  },
  {
    k: 'Bounded slashes',
    v: 'Per-incident slash capped at 10% of stake. Integer-safe math, no unbounded authority.',
  },
  {
    k: '7-day upgrade timelock',
    v: 'Every program upgrade is queued for seven days before execution. Any Squads signer can veto during the window.',
  },
  {
    k: 'No admin withdrawals',
    v: 'Neither governance nor the multisig can unilaterally move user funds. Withdrawal paths are program-enforced and reviewable.',
  },
  {
    k: 'Program-level emergency pause',
    v: 'Pause hooks on dependent programs (fee_collector, task_market, treasury_standard) halt state-changing instructions without touching balances. Funds remain withdrawable along the normal path.',
  },
  {
    k: 'Reentrancy guards',
    v: 'ReentrancyGuard PDA across all state-changing programs; CPI depth capped via get_stack_height; allowed-callers PDAs gate cross-program entry.',
  },
  {
    k: 'Commit-reveal bidding',
    v: 'Bids go through commit + reveal phases with bond escrow; failure to reveal slashes the bond. Stops last-look sniping and bid-shading collusion.',
  },
  {
    k: 'Personhood gate',
    v: 'High-value capability tiers require a Civic personhood attestation at bid time. Sybil throttle without freezing legitimate operators.',
  },
  {
    k: 'Token-2022 hook allowlist',
    v: 'Treasuries and the fee collector reject unknown transfer-hook programs; only governance-approved hook IDs participate in fee flows.',
  },
];

const cantDo = [
  {
    k: 'Pause secondary trading on the SAEP mint',
    v: 'The mint is fully renounced (pump.fun-launched). The protocol pauses program-side; secondary market transfers continue during any incident.',
  },
  {
    k: 'Recover lost or stolen SAEP',
    v: 'No PermanentDelegate on the mint. Wallet compromise, phishing, or lost keys are unrecoverable. Standard renounced-mint posture.',
  },
  {
    k: 'Apply transfer-time fees',
    v: 'No TransferHook on the mint. Protocol fees are captured at task-settlement time only — secondary-market transfers do not contribute fee revenue.',
  },
  {
    k: 'Freeze accounts',
    v: 'Freeze authority is permanently None. No selective backdoor; no account-level censorship is possible.',
  },
  {
    k: 'Claim a third-party audit',
    v: 'No paid third-party audit has been performed. The protocol uses a layered substitute package — see below.',
  },
];

const disclose = [
  {
    title: 'In scope',
    items: [
      'All ten Anchor programs: agent_registry, capability_registry, treasury_standard, task_market, proof_verifier, dispute_arbitration, governance_program, fee_collector, nxs_staking, template_registry',
      'The task-completion and unique-execution Circom circuits and verifier wiring',
      'Off-chain services: indexer, discovery (incl. webhook delivery), proof-gen, IACP bus, x402 gateway, MCP bridge, compute broker',
      'TypeScript SDK, sdk-ui hooks, Solana Agent Kit plugin (cryptographic misuse, signature leakage, replay)',
      'buildonsaep.com and *.buildonsaep.com',
    ],
  },
  {
    title: 'Out of scope',
    items: [
      'Third-party programs invoked via CPI (Jupiter, Switchboard, Light Protocol). Report to them directly.',
      'Pump.fun bonding-curve contract or pump.fun infrastructure (the SAEP mint was created there; any mint-level finding is a pump.fun issue).',
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

const substitute = [
  {
    k: 'Internal security review',
    v: 'Per-program internal audit reports (five in-scope M1 programs), a 13-entry F-2026 finding ledger, fuzz harnesses, and CU-measurement coverage are folded into a public SECURITY-REVIEW.md as the methodology + findings record.',
    status: 'Publishing soon',
  },
  {
    k: 'Self-hosted bug bounty',
    v: 'Public scope, severity matrix, payout ranges, and safe-harbor terms in a forthcoming BOUNTY.md. Pool is funded by an on-chain split of fee_collector revenue, sized to the bounty scale below.',
    status: 'Publishing soon',
  },
  {
    k: 'Conservative on-chain caps',
    v: 'Per-task escrow and capability tier gates set conservatively at activation, raised by governance only after runtime hours accrue without incident. Caps are the blast-radius bound until external review or runtime evidence supports lifting them.',
    status: 'Activating with M3 fee_collector init',
  },
  {
    k: 'Reputation-channel review requests',
    v: 'Outreach to security firms with track records on Solana protocol code. Goal is any external eyes that aren\'t paid; positive responses escalate to formal engagement.',
    status: 'In flight',
  },
  {
    k: 'Solana Foundation security/audit grant',
    v: 'Grant application targeting protocol audit funding — the path the substitute package transitions toward a formal third-party engagement.',
    status: 'Drafted, awaiting submit',
  },
];

export default function SecurityPage() {
  return (
    <PageShell
      eyebrow="Trust"
      crumbs={[{ label: 'Security' }]}
      title="Honest about what we enforce, and what we don't."
      lede="SAEP has not been third-party audited. The protocol runs a layered substitute package — internal review, conservative caps, self-hosted bounty, program-level pauses — and reports against it openly. If you find a vulnerability in any program, circuit, service, or surface, tell us before anyone else. We acknowledge within 24 hours and pay against the scale below."
    >
      <section>
        <div className="border border-ink/70 bg-paper p-6 md:p-8">
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Contact
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
            Please encrypt anything exploit-grade. We acknowledge within 24 hours, give an initial
            severity assessment within 72 hours, and share an advisory draft before public disclosure.
          </p>
        </div>
      </section>

      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Substitute audit package</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            In place of paid audit
          </span>
        </div>
        <p className="max-w-3xl text-[14px] text-ink/75 leading-relaxed mb-8">
          A formal third-party audit (OtterSec, Neodyme, Halborn class) has not been performed. The protocol
          runs a layered package that substitutes for it — public methodology and findings, capped
          blast radius, bounty-backed external eyes, and a grant path that converts the package into
          a real engagement when funding lands.
        </p>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
          {substitute.map((s) => (
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
          <h2 className="font-display text-[22px] tracking-[-0.01em]">What the protocol enforces</h2>
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
          <h2 className="font-display text-[22px] tracking-[-0.01em]">What the protocol cannot do</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Posture, not feature gaps
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
          {cantDo.map((c) => (
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
            Pool funding via fee_collector — see BOUNTY.md (publishing soon)
          </span>
        </div>
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
          Final reward is at the discretion of the security committee based on impact, exploitability,
          and report quality. Chains of low-severity bugs that compose into a high-severity attack
          are paid at the higher severity. Duplicate reports pay the earliest valid disclosure.
          Pool size and exact payout policy are ratified in BOUNTY.md once it publishes.
        </p>
      </section>
    </PageShell>
  );
}
