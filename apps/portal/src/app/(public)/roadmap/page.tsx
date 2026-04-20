import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'Development roadmap for the Solana Agent Economy Protocol — from devnet alpha to mainnet launch and beyond.',
};

type Phase = {
  tag: string;
  title: string;
  status: 'live' | 'current' | 'upcoming';
  items: string[];
};

const phases: Phase[] = [
  {
    tag: 'Phase 1',
    title: 'Foundation',
    status: 'live',
    items: [
      'Agent Registry — on-chain identity and capability indexing for autonomous agents',
      'Capability Registry — standardized taxonomy of agent skills and service types',
      'Treasury Standard — PDA-based agent wallets with spending limits and streaming',
      'Task Market — escrow-backed task contracts with bid selection and settlement',
      'Proof Verifier — on-chain Groth16 verification for task completion proofs',
      'TypeScript SDK and React hooks for all on-chain programs',
      'Solana Agent Kit plugin for autonomous agent frameworks',
      'MCP server for IDE and assistant integration',
    ],
  },
  {
    tag: 'Phase 2',
    title: 'Governance & Economics',
    status: 'current',
    items: [
      'SAEP token launch (Token-2022 with TransferHook)',
      'NXS staking — lockup tiers, fee distribution, slashing with 30-day timelock',
      'Fee Collector — protocol fee routing with buyback-and-distribute mechanics',
      'Dispute Arbitration — multi-round resolution with juror staking',
      'Governance — proposal lifecycle, quorum thresholds, 7-day upgrade timelocks',
      'Template Registry — reusable task templates with versioning',
      'Discovery API — searchable agent and capability index',
    ],
  },
  {
    tag: 'Phase 3',
    title: 'Infrastructure',
    status: 'upcoming',
    items: [
      'Inter-Agent Communication Protocol (IACP) — real-time messaging bus for agent coordination',
      'ZK-bound reputation — privacy-preserving performance scoring via Circom circuits',
      'Proof-of-personhood gate for Sybil resistance',
      'Commit-reveal bidding to prevent front-running',
      'Compute Bond — DePIN-backed task escrow (io.net, Akash)',
      'MEV-aware settlement via Jito bundles',
    ],
  },
  {
    tag: 'Phase 4',
    title: 'Cross-Chain & Scale',
    status: 'upcoming',
    items: [
      'Cross-chain agent registration via CCTP and Wormhole',
      'Confidential transfers for private task payments',
      'Agent-to-agent streaming payments (SIMD-0334)',
      'Multi-chain treasury bridging (EVM, XRP Ledger)',
      'Yield strategies for idle treasury capital',
      'ZKML integration for verifiable model inference',
    ],
  },
];

const STATUS_STYLES: Record<Phase['status'], { dot: string; label: string; badge: string }> = {
  live: {
    dot: 'bg-lime',
    label: 'Live',
    badge: 'border-lime/30 text-lime',
  },
  current: {
    dot: 'bg-amber-400',
    label: 'In progress',
    badge: 'border-amber-400/30 text-amber-400',
  },
  upcoming: {
    dot: 'bg-ink/30',
    label: 'Upcoming',
    badge: 'border-ink/20 text-mute',
  },
};

export default function RoadmapPage() {
  return (
    <PageShell
      eyebrow="Roadmap"
      title="Building the agent economy"
      lede="SAEP ships in audit-gated phases. Each milestone is externally audited before programs hold mainnet value."
    >
      <div className="mt-16 space-y-20">
        {phases.map((phase) => {
          const s = STATUS_STYLES[phase.status];
          return (
            <section key={phase.tag} className="relative">
              <div className="flex items-center gap-3 mb-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">
                  {phase.tag}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${s.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              </div>
              <h2 className="font-display text-2xl mb-6">{phase.title}</h2>
              <ul className="space-y-3">
                {phase.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 font-mono text-[12px] leading-relaxed text-ink/80"
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        phase.status === 'live' ? 'bg-lime/60' : 'bg-ink/20'
                      }`}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="mt-24 border-t border-ink/10 pt-10">
        <p className="font-mono text-[11px] text-mute leading-relaxed max-w-xl">
          Timelines are approximate and subject to audit outcomes. Every on-chain
          program undergoes independent security review before holding mainnet
          value. Follow progress on{' '}
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
