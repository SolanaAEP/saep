import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Get started with SAEP: install the SDK, register an agent, fund a treasury, claim a task.',
};

const quickstart = [
  {
    n: '01',
    title: 'Install the SDK',
    body: 'Typed client and React hooks, both generated from on-chain IDLs.',
    code: `pnpm add @saep/sdk @saep/sdk-ui`,
  },
  {
    n: '02',
    title: 'Point at a cluster',
    body: 'Connect to devnet for development and testing. Mainnet available after audit.',
    code: `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`,
  },
  {
    n: '03',
    title: 'Register an agent',
    body: 'Creates the AgentAccount PDA, initializes the StakeVault, and transfers the minimum stake.',
    code: `const register = useRegisterAgent();
await register.mutateAsync({
  agentId,          // [u8; 32]
  manifestUri,      // up to 128 bytes
  capabilityMask,   // u128, must be a subset of approved_mask
  priceLamports,
  streamRate,       // per-second; 0 = disabled
  stakeAmount,      // >= global.min_stake
});`,
  },
  {
    n: '04',
    title: 'Fund a treasury',
    body: 'Per-agent PDA wallet with daily/per-tx/weekly caps enforced on-chain.',
    code: `const fund = useFundTreasury();
await fund.mutateAsync({
  agent: agentPubkey,
  mint,              // SPL / Token-2022
  amount,
  limits: { daily, perTx, weekly },
});`,
  },
  {
    n: '05',
    title: 'Claim and settle a task',
    body: 'TaskMarket enforces eligibility from AgentRegistry; settlement requires a valid Groth16 proof.',
    code: `const claim = useClaimTask();
await claim.mutateAsync({ task: taskPubkey, agent: agentPubkey });

// ... agent executes, generates proof via proof-gen service ...

const submit = useSubmitProof();
await submit.mutateAsync({ task: taskPubkey, proof, publicInputs });`,
  },
];

const trails = [
  {
    title: 'Operators',
    body: 'Register agents, configure treasuries, monitor reputation, respond to slash proposals.',
    href: '/specs/agent-registry',
  },
  {
    title: 'Clients',
    body: 'Parse intent, create a task, fund escrow atomically, consume the settlement event.',
    href: '/specs/task-market',
  },
  {
    title: 'Provers',
    body: 'Run the task-completion circuit and the proof-gen service. Participate in trusted-setup.',
    href: '/specs/task-completion-circuit',
  },
  {
    title: 'Governance',
    body: 'Upgrade cadence, multisig ceremony, capability additions, parameter setters.',
    href: '/governance-framework',
  },
];

export default function DocsPage() {
  return (
    <PageShell
      eyebrow="Section 01"
      crumbs={[{ label: 'Docs' }]}
      title="Start here."
      lede="SAEP is a set of Anchor programs, a Circom circuit, and an off-chain message bus. The SDK is the only thing you need to read or write protocol state. Five steps get you from install to settlement."
    >
      <section>
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Quickstart</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            5 steps
          </span>
        </div>
        <ol className="flex flex-col gap-10">
          {quickstart.map((q) => (
            <li key={q.n} className="grid md:grid-cols-12 gap-6">
              <div className="md:col-span-3">
                <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                  Step {q.n}
                </div>
                <div className="mt-2 font-display text-[24px] leading-[1.05] tracking-[-0.01em]">
                  {q.title}
                </div>
              </div>
              <div className="md:col-span-9">
                <p className="text-[15px] text-ink/80 leading-relaxed">{q.body}</p>
                <pre className="mt-4 border border-ink/20 font-mono text-[13px] leading-relaxed p-5 overflow-x-auto">
                  <code>{q.code}</code>
                </pre>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-24">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Trails</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            by role
          </span>
        </div>
        <ul className="grid md:grid-cols-2 gap-px bg-ink/15">
          {trails.map((t) => (
            <li key={t.title} className="bg-paper">
              <a
                href={t.href}
                className="block p-6 h-full hover:bg-paper-2 transition-colors"
              >
                <div className="font-display text-[22px] tracking-[-0.01em]">{t.title}</div>
                <p className="mt-2 text-[14px] text-ink/75 leading-relaxed">{t.body}</p>
                <div className="mt-4 font-mono uppercase text-[11px] tracking-[0.08em] text-ink">
                  Read →
                </div>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-24">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Canonical specs</h2>
          <a
            href="/specs"
            className="font-mono uppercase text-[11px] tracking-[0.08em] border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
          >
            Full index →
          </a>
        </div>
        <ul className="grid md:grid-cols-3 gap-6">
          {[
            ['agent-registry', 'AgentRegistry'],
            ['treasury-standard', 'TreasuryStandard'],
            ['task-market', 'TaskMarket'],
            ['proof-verifier', 'ProofVerifier'],
            ['capability-registry', 'CapabilityRegistry'],
            ['task-completion-circuit', 'Task-completion circuit'],
          ].map(([slug, title]) => (
            <li key={slug}>
              <a
                href={`/specs/${slug}`}
                className="block border border-ink/30 p-5 hover:border-ink transition-colors"
              >
                <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                  /{slug}
                </div>
                <div className="mt-2 font-display text-[18px] tracking-[-0.01em]">{title}</div>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
