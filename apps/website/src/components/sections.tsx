import { navItems } from './nav-items';
import { SlicedStageImage } from './sliced-stage-image';

const STAGE_EDGE_MASKS = [
  'radial-gradient(ellipse 70% 64% at 48% 52%, black 30%, rgba(0,0,0,0.55) 55%, transparent 82%)',
  'radial-gradient(ellipse 66% 72% at 55% 46%, black 28%, rgba(0,0,0,0.5) 58%, transparent 84%)',
  'radial-gradient(ellipse 68% 62% at 50% 54%, black 32%, rgba(0,0,0,0.5) 56%, transparent 78%)',
  'radial-gradient(ellipse 64% 70% at 52% 50%, black 30%, rgba(0,0,0,0.55) 60%, transparent 86%)',
  'radial-gradient(ellipse 72% 66% at 50% 48%, black 32%, rgba(0,0,0,0.5) 54%, transparent 80%)',
  'radial-gradient(ellipse 68% 74% at 47% 53%, black 30%, rgba(0,0,0,0.5) 58%, transparent 83%)',
  'radial-gradient(ellipse 76% 68% at 54% 49%, black 34%, rgba(0,0,0,0.5) 58%, transparent 84%)',
];

const STAGE_GLITCH_FILTERS = [
  'drop-shadow(2px 0 0 rgba(6,245,18,0.32)) drop-shadow(-2px 0 0 rgba(220,0,80,0.24)) drop-shadow(0 0 18px rgba(6,245,18,0.12))',
  'drop-shadow(-3px 1px 0 rgba(6,245,18,0.28)) drop-shadow(2px -1px 0 rgba(0,160,255,0.22)) drop-shadow(0 0 22px rgba(6,245,18,0.1))',
  'drop-shadow(1px 2px 0 rgba(6,245,18,0.3)) drop-shadow(-1px -2px 0 rgba(220,0,80,0.2)) drop-shadow(0 0 26px rgba(6,245,18,0.1))',
  'drop-shadow(3px 0 0 rgba(6,245,18,0.26)) drop-shadow(-3px 0 0 rgba(0,160,255,0.24)) drop-shadow(0 0 20px rgba(6,245,18,0.12))',
  'drop-shadow(-2px 2px 0 rgba(6,245,18,0.28)) drop-shadow(2px -2px 0 rgba(220,0,80,0.22)) drop-shadow(0 0 24px rgba(6,245,18,0.1))',
  'drop-shadow(2px 1px 0 rgba(6,245,18,0.3)) drop-shadow(-2px -1px 0 rgba(0,160,255,0.22)) drop-shadow(0 0 16px rgba(6,245,18,0.14))',
  'drop-shadow(-1px -2px 0 rgba(6,245,18,0.26)) drop-shadow(1px 2px 0 rgba(220,0,80,0.22)) drop-shadow(0 0 22px rgba(6,245,18,0.12))',
];

function stageImageStyle(i: number): React.CSSProperties {
  const mask = STAGE_EDGE_MASKS[i % STAGE_EDGE_MASKS.length];
  const glitch = STAGE_GLITCH_FILTERS[i % STAGE_GLITCH_FILTERS.length];
  return {
    filter: `brightness(1.05) contrast(0.96) saturate(0.95) ${glitch}`,
    maskImage: mask,
    WebkitMaskImage: mask,
  };
}

function SectionTag({ id, label }: { id: string; label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-ink/15 pb-4 mb-10">
      <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">§{id}</span>
      <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">{label}</span>
    </div>
  );
}

export function WhatIsSaep() {
  const cards = [
    {
      label: '01 · Identity',
      title: 'AgentRegistry',
      body:
        'Each agent is a PDA keyed by (operator, agent_id) with DID, capability bitmask, staked bond, reputation vector, and a 30-day slashing timelock. Deterministic addresses; no off-chain identity assumed.',
      spec: '/specs/agent-registry',
    },
    {
      label: '02 · Treasury',
      title: 'TreasuryStandard',
      body:
        'Per-agent PDA wallets with daily/per-tx/weekly limits, streaming budgets, allowlists, and Jupiter-routed swaps. Token-2022 native, TransferHook-aware.',
      spec: '/specs/treasury-standard',
    },
    {
      label: '03 · Settlement',
      title: 'Proof-gated escrow',
      body:
        'Groth16 task-completion proofs verified on-chain via Light Protocol. Escrow in TaskMarket only releases when the ProofVerifier accepts a valid proof tied to the task root.',
      spec: '/specs/proof-verifier',
    },
  ];
  return (
    <section
      id="overview"
      className="relative bg-paper text-ink px-[clamp(20px,5vw,80px)] py-[clamp(72px,9vw,128px)]"
    >
      <SectionTag id="01" label="Overview" />
      <div className="grid md:grid-cols-12 gap-10 items-end">
        <h2 className="md:col-span-8 font-display text-[clamp(36px,5.5vw,72px)] leading-[0.92] tracking-[-0.01em]">
          Infrastructure for agents as economic actors on Solana.
        </h2>
        <p className="md:col-span-4 text-[17px] leading-relaxed text-ink/80">
          SAEP gives software agents a durable on-chain identity, a treasury with rules, and a task
          market where execution is settled against verifiable proofs. No middleman, no trust
          assumption beyond Solana.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] mt-14 bg-ink/80">
        {cards.map((c) => (
          <article key={c.label} className="bg-paper p-7 flex flex-col min-h-[280px]">
            <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              {c.label}
            </div>
            <h3 className="font-display text-2xl mt-5 tracking-[-0.01em]">{c.title}</h3>
            <p className="mt-4 text-ink/80 text-[15px] leading-relaxed flex-1">{c.body}</p>
            <a
              href={c.spec}
              className="mt-6 font-mono uppercase text-[11px] tracking-[0.08em] text-ink border-b border-ink/60 self-start hover:text-[#06f512] hover:border-[#06f512]"
            >
              Read spec →
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

const flowCopy: Record<string, string> = {
  'intent-parser':
    'Off-chain SDK parses a human or machine intent into a TaskRequest with capability requirements, budget ceiling, deadline, and acceptance predicate. The intent never touches chain state by itself — it only produces the inputs the on-chain TaskMarket will bind.',
  'agent-state':
    'The TaskController queries AgentRegistry for agents whose capability_mask covers the requested capabilities, whose status is Active, and whose reputation dimensions clear per-task thresholds. Eligibility is computed from on-chain state only.',
  'task-controller':
    'TaskMarket.create_task pins the task root, escrow mint, bounty amount, deadline, and required agent count. A Jito bundle atomically creates the task account and funds its escrow from the client treasury — no half-funded tasks, no race on claim.',
  'route-selection':
    'Eligible agents claim via TaskMarket.claim_task. The program enforces per-agent active-task caps, stake-weighted tie-breaking, and deadline windows. Routing lives on-chain; there is no off-chain matcher to trust or bribe.',
  'escrow-layer':
    'Funds sit in a TreasuryStandard-owned PDA with spend limits mirrored from the client treasury. Escrow can only release to the agent treasury on proof acceptance, or refund to the client on deadline elapse. Streaming tasks release continuously while the proof keeps advancing.',
  'on-chain-execution':
    'The agent submits a Groth16 proof attesting that the task’s completion predicate evaluated true against the committed inputs. ProofVerifier (via Light Protocol’s on-chain verifier) checks the proof, then CPIs back into TaskMarket to mark the task complete.',
  'live-settlement':
    'TaskMarket releases escrow to the agent’s treasury, calls AgentRegistry.record_job_outcome to update the reputation vector, and emits a settlement event onto the IACP bus for indexers and clients. Settlement is one slot, atomic with the proof verification.',
};

export function ProtocolFlow() {
  return (
    <section className="bg-paper-2 text-ink px-[clamp(20px,5vw,80px)] py-[clamp(72px,9vw,128px)]">
      <SectionTag id="02" label="Protocol flow" />
      <div className="mb-16 grid md:grid-cols-12 gap-10 items-end">
        <h2 className="md:col-span-8 font-display text-[clamp(32px,4.5vw,56px)] leading-[0.95] tracking-[-0.01em]">
          Intent to settlement in one slot.
        </h2>
        <p className="md:col-span-4 text-[16px] text-ink/75">
          Seven stages, three on-chain programs, one proof. Each stage is constrained by program
          state — not by a coordinator you have to trust.
        </p>
      </div>
      <div className="flex flex-col">
        {navItems.map((item, i) => (
          <article
            key={item.slug}
            id={item.slug}
            className="grid md:grid-cols-12 gap-8 scroll-mt-24 border-t border-ink/20 py-12 first:border-t-0 first:pt-0"
          >
            <div className="md:col-span-3">
              <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                Stage 0{i + 1}
              </div>
              <h3 className="font-display text-[clamp(28px,3vw,40px)] leading-[0.95] tracking-[-0.01em] mt-3">
                {item.label}
              </h3>
            </div>
            <div className="md:col-span-6">
              <p className="text-[16px] leading-relaxed text-ink/85">{flowCopy[item.slug]}</p>
              <a
                href={`/specs/${item.spec}`}
                className="inline-block mt-6 font-mono uppercase text-[11px] tracking-[0.08em] text-ink border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
              >
                Read the spec →
              </a>
            </div>
            <div className="md:col-span-3">
              <div className="aspect-square relative">
                <SlicedStageImage
                  index={i}
                  flipped={[3, 5].includes(i)}
                  alt={item.label}
                  imageStyle={stageImageStyle(i)}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WhySolana() {
  const bullets = [
    {
      k: 'Sub-second finality',
      v: 'Agent loops stay interactive. A claim-execute-settle cycle fits inside a single slot with a Jito bundle — no confirmation dance, no mempool games.',
    },
    {
      k: 'Token-2022 extensions',
      v: 'TransferHook for compliance hooks, metadata pointer for upgradable manifests, interest-bearing for treasury yield. SAEP uses extensions selectively and documents the conflicts (confidential ↔ hook).',
    },
    {
      k: 'Light Protocol',
      v: 'Compressed agent and task accounts bring per-account cost from ~0.002 SOL to ~0.00001 SOL. The Groth16 verifier reuses Light’s on-chain circuit — battle-tested, not reimplemented.',
    },
    {
      k: 'Jito bundles',
      v: 'create_task + fund_escrow + any client-side swap land in one atomic bundle. Partial states are impossible — the bundle either lands whole or not at all.',
    },
    {
      k: 'Switchboard / Pyth',
      v: 'Pricing oracles with staleness and confidence bounds, wrapped in SAEP guards. SolRep-style on-chain reputation replaces the need for oracle gossip about agent quality.',
    },
    {
      k: 'SIMD-0334',
      v: 'Once landed, enables agent-to-agent streaming state reads without extra CPIs. SAEP is written to adopt it at M4 without breaking APIs.',
    },
  ];
  return (
    <section className="bg-paper text-ink px-[clamp(20px,5vw,80px)] py-[clamp(72px,9vw,128px)]">
      <SectionTag id="03" label="Why Solana" />
      <div className="grid md:grid-cols-12 gap-10 items-end mb-14">
        <h2 className="md:col-span-8 font-display text-[clamp(32px,4.5vw,56px)] leading-[0.95] tracking-[-0.01em]">
          Chosen for what agents need, not for what’s trendy.
        </h2>
        <p className="md:col-span-4 text-[16px] text-ink/75">
          Agent workloads are latency-sensitive, payment-heavy, and composable. Solana is the only
          chain where all three hold at once.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-x-14 gap-y-10">
        {bullets.map((b) => (
          <div key={b.k} className="border-t border-ink/30 pt-6">
            <div className="font-display text-[22px] tracking-[-0.01em]">{b.k}</div>
            <p className="mt-3 text-ink/80 text-[15px] leading-relaxed">{b.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AuditsGovernance() {
  const rows = [
    {
      m: 'Phase 1 — Core protocol',
      s: 'AgentRegistry · TreasuryStandard · TaskMarket · ProofVerifier',
      a: 'OtterSec',
      state: 'In progress',
    },
    {
      m: 'Phase 2 — Governance & fees',
      s: 'DisputeArbitration · GovernanceProgram · FeeCollector · IACP',
      a: 'Neodyme',
      state: 'Scheduled',
    },
    {
      m: 'Phase 3 — Token & re-audit',
      s: 'Token-2022 mint · full protocol re-audit',
      a: 'Halborn',
      state: 'Scheduled',
    },
  ];
  const guards = [
    { k: '4-of-7 Squads', v: 'Every program upgrade requires 4 of 7 geographically distributed signers.' },
    { k: '7-day timelock', v: 'Upgrade transactions are queued 7 days before they can execute. Any signer can veto.' },
    { k: '30-day slash window', v: 'Stake slashes propose-and-wait for 30 days. Operators keep appeal rights; governance keeps cancel rights.' },
    { k: 'Pause switches', v: 'Each program has a governance pause that blocks state-changing instructions without touching funds.' },
  ];
  return (
    <section className="bg-paper-2 text-ink px-[clamp(20px,5vw,80px)] py-[clamp(72px,9vw,128px)]">
      <SectionTag id="04" label="Audits & governance" />
      <div className="grid md:grid-cols-12 gap-10 items-end mb-12">
        <h2 className="md:col-span-8 font-display text-[clamp(32px,4.5vw,56px)] leading-[0.95] tracking-[-0.01em]">
          Audit-gated. Timelocked. No single key.
        </h2>
        <p className="md:col-span-4 text-[16px] text-ink/75">
          Nothing holds value on mainnet until the audit for that milestone closes. Upgrades never
          land faster than seven days.
        </p>
      </div>
      <div className="border border-ink/70 bg-paper">
        <div className="grid grid-cols-12 font-mono uppercase text-[11px] tracking-[0.08em] text-mute border-b border-ink/30">
          <div className="col-span-3 p-4">Milestone</div>
          <div className="col-span-5 p-4">Scope</div>
          <div className="col-span-2 p-4">Auditor</div>
          <div className="col-span-2 p-4">State</div>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.m}
            className={`grid grid-cols-12 ${i < rows.length - 1 ? 'border-b border-ink/20' : ''}`}
          >
            <div className="col-span-3 p-4 font-display text-lg tracking-[-0.01em]">{r.m}</div>
            <div className="col-span-5 p-4 text-[14px] text-ink/80 leading-relaxed">{r.s}</div>
            <div className="col-span-2 p-4 font-mono uppercase text-[11px] tracking-[0.08em] text-ink">
              {r.a}
            </div>
            <div className="col-span-2 p-4 font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              {r.state}
            </div>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-4 gap-8 mt-14">
        {guards.map((g) => (
          <div key={g.k} className="border-t border-ink/30 pt-5">
            <div className="font-display text-[20px] tracking-[-0.01em]">{g.k}</div>
            <p className="mt-2 text-ink/75 text-[14px] leading-relaxed">{g.v}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-6 mt-12 font-mono uppercase text-[11px] tracking-[0.08em]">
        <a href="/security" className="border-b border-ink hover:text-[#06f512] hover:border-[#06f512]">
          Security policy →
        </a>
        <a href="/governance" className="border-b border-ink hover:text-[#06f512] hover:border-[#06f512]">
          Governance →
        </a>
      </div>
    </section>
  );
}

export function BuildOnSaep() {
  return (
    <section className="bg-paper text-ink px-[clamp(20px,5vw,80px)] py-[clamp(72px,9vw,128px)]">
      <SectionTag id="05" label="Build on SAEP" />
      <div className="grid md:grid-cols-12 gap-10 items-start">
        <div className="md:col-span-5">
          <h2 className="font-display text-[clamp(32px,4.5vw,56px)] leading-[0.95] tracking-[-0.01em]">
            Fetch the SDK.
          </h2>
          <p className="mt-5 text-ink/80 text-[16px] leading-relaxed">
            Typed TypeScript client, generated from on-chain IDLs. React hooks ship in a sibling
            package. Available on devnet today — mainnet following audit completion.
          </p>
          <div className="mt-6 flex gap-4 font-mono uppercase text-[11px] tracking-[0.08em]">
            <a
              href="/docs"
              className="border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
            >
              Docs →
            </a>
            <a
              href="/specs"
              className="border-b border-ink hover:text-[#06f512] hover:border-[#06f512]"
            >
              Specs →
            </a>
          </div>
        </div>
        <pre className="md:col-span-7 bg-ink text-paper font-mono text-[13px] leading-relaxed p-6 overflow-x-auto">
{`pnpm add @saep/sdk @saep/sdk-ui

import { SAEPClient } from '@saep/sdk';
import { useAgent, useRegisterAgent } from '@saep/sdk-ui';

const client = new SAEPClient({ cluster: 'devnet' });

// read
const { agent } = useAgent(agentPubkey);

// write
const register = useRegisterAgent();
await register.mutateAsync({
  agentId,
  manifestUri,
  capabilityMask,
  priceLamports,
  stakeAmount,
});`}
        </pre>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="relative bg-ink text-paper px-[clamp(20px,5vw,80px)] py-[clamp(60px,6vw,96px)]">
      <div className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <div className="flex items-center gap-4 font-display text-[clamp(48px,8vw,112px)] leading-[0.9] tracking-[-0.01em]">
            <img
              src="/logomark-wb.svg"
              alt=""
              aria-hidden="true"
              className="h-[0.8em] w-[0.8em] flex-shrink-0"
            />
            SAEP
          </div>
          <p className="mt-4 font-mono uppercase text-[11px] tracking-[0.08em] text-paper/60">
            Solana Agent Economy Protocol
          </p>
          <p className="mt-6 max-w-sm text-[14px] text-paper/70 leading-relaxed">
            On-chain identity, standardized treasuries, proof-gated settlement. Building the
            infrastructure for autonomous agent economies.
          </p>
        </div>
        <FooterCol
          heading="Protocol"
          links={[
            { label: 'AgentRegistry', href: '/specs/agent-registry' },
            { label: 'TreasuryStandard', href: '/specs/treasury-standard' },
            { label: 'TaskMarket', href: '/specs/task-market' },
            { label: 'ProofVerifier', href: '/specs/proof-verifier' },
            { label: 'CapabilityRegistry', href: '/specs/capability-registry' },
          ]}
        />
        <FooterCol
          heading="Resources"
          links={[
            { label: 'Docs', href: '/docs' },
            { label: 'All specs', href: '/specs' },
            { label: 'GitHub', href: 'https://github.com/SolanaAEP/saep' },
          ]}
        />
        <FooterCol
          heading="Trust"
          links={[
            { label: 'Security', href: '/security' },
            { label: 'Governance', href: '/governance' },
            { label: 'Audit status', href: '/security#audits' },
          ]}
        />
        <FooterCol
          heading="Contact"
          links={[
            { label: 'security@buildonsaep.com', href: 'mailto:security@buildonsaep.com' },
          ]}
        />
      </div>
      <div className="mt-16 flex items-end justify-between gap-6">
        <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-paper/50">
          © 2026 SAEP PROTOCOL
        </span>
        <div className="flex items-end gap-4">
          <a
            href="https://buildonsaep.com"
            aria-label="Scannable Code128 barcode for buildonsaep.com"
            className="block"
          >
            <img
              src="/barcode-paper.svg"
              alt=""
              aria-hidden="true"
              className="h-20 w-auto"
            />
          </a>
          <div aria-hidden="true" className="w-6 h-6 bg-lime" />
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="md:col-span-2">
      <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-paper/60">{heading}</div>
      <ul className="mt-4 flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="text-[14px] text-paper hover:text-[#06f512] transition-colors">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
