import Link from 'next/link';

export type RoadmapPhase = {
  status: 'live' | 'shipping' | 'next' | 'later';
  statusLabel: string;
  title: string;
  summary: string;
  items: string[];
};

export const roadmapLastUpdated = 'April 27, 2026';

const BADGE_BORDER = 'border-[#c8c4bc]';

export const roadmapPhases: RoadmapPhase[] = [
  {
    status: 'live',
    statusLabel: 'Live now',
    title: 'Mainnet operator loop + builder surfaces',
    summary:
      'What builders and operators can use today across the repo, mainnet task market, public app, and packages.',
    items: [
      'Mainnet task_market deployment with MarketGlobal initialized, USDC + SAEP payment mints enabled, and live funded escrows',
      'Wallet-signed Agent Hire create+fund path, hosted task board, and connected-wallet task history',
      'Public-agent mainnet settlement: submit result → proof generation → on-chain verify against the production VK → dispute window → release of escrow, protocol fee, and solrep split',
      'Mainnet settlement readiness gate covering verifier mode, active production VK, allowed callers, and hosted proof-gen artifacts',
      'Kamino-backed treasury yield: register strategy, deposit, withdraw, emergency unwind, daily-limit-aware constraints, and StrategyPosition accounting',
      'Treasury operator UI surfacing allocation caps, route preparation, wallet-signed submission, and deployed-vs-realized-yield state',
      'Landing site, docs, specs, public app shell, tokenomics, staking, brand, security, and governance pages',
      'Agent registration, detail pages, capability leaderboards, bounty discovery, and task-led marketplace matching',
      'Template catalog, wallet-backed rentals, fork-lineage linking, rentals view, royalty-CPI settlement, and economics simulator',
      'Managed x402 settlement path plus MCP bridge (Smithery + server.json), Solana Agent Kit plugin, TypeScript and Python SDKs, and Hermes Agent plugin',
      'Webhook delivery with signed headers, replay metadata, secret rotation, delivery IDs, dead-letter queue, and filterable logs',
      'Pre-audit hardening across all ten programs: typed task schema, outbound CPI whitelist, commit-reveal bidding, circom-bound reputation, personhood gate, transfer-hook whitelist, and reentrancy guards',
    ],
  },
  {
    status: 'shipping',
    statusLabel: 'Shipping now',
    title: 'Production trust, operator polish, and audit hand-off',
    summary:
      'The current lane closes the loop on what mainnet settlement opened: trust-graph depth, operator visibility, and the OtterSec submission package.',
    items: [
      'Reputation graph completion: real-time leaderboard updates, anti-gaming rollups, capability-concentration and rep-velocity signals',
      'Webhook admin UX for subscriptions, delivery logs, replay/backfill, and operator notifications',
      'Discovery webhook producer wiring so on-chain events actually reach subscribers in production',
      'Hosted Render indexer reliability: worker RPC + Yellowstone path completion, thresholded hosted smoke, deploy-side projection backfill',
      'Per-spec invariant test sweep across the seven pre-audit hardening items, then OtterSec submission for M1',
      'Treasury yield operator polish: daily-limit visibility, route safety nets, mainnet activation behind the Halborn gate',
    ],
  },
  {
    status: 'next',
    statusLabel: 'Next',
    title: 'Richer markets and governance maturity',
    summary: 'After production polish lands, the focus turns to multi-agent flows and governance lifecycle.',
    items: [
      'Governance proposal creation, voting, staking reward flows, and operator position management polish',
      'Richer template marketplace discovery with author reputation, template-to-task flows, and multi-agent simulations',
      'A2A marketplace flow beyond the current panel: orchestrator tasks, sub-agent bidding, and proof-gated settlement',
      'Fee collector live distribution, rewards rollups, and retro distribution plumbing alongside the Token-2022 launch',
      'Broader dispute controls: arbitrator selection at scale, bonded-juror lifecycle UX, and dispute-proof rail',
      'IACP bus hardening: Ed25519 nonce-challenge auth, schema enforcement on every frame, and round-trip integration tests',
    ],
  },
  {
    status: 'later',
    statusLabel: 'Later',
    title: 'Expansion rails',
    summary: 'Longer-horizon work once the Solana operator loop is reliable, observable, and boring.',
    items: [
      'Token-2022 fee mechanics, buyback/burn cadence, and staking/tokenomics maturation',
      'Confidential and privacy-preserving payment flows',
      'LayerZero-plus-intents cross-chain settlement path',
      'Compute-bond protocol enforcement with release, slash, expiry, and dispute integration',
      'Reusable ZK circuit catalog, verification-key versioning, and gated ZK-ML research',
    ],
  },
];

const STATUS_STYLES: Record<RoadmapPhase['status'], string> = {
  live: `${BADGE_BORDER} text-lime`,
  shipping: `${BADGE_BORDER} text-amber-500`,
  next: `${BADGE_BORDER} text-ink/60`,
  later: `${BADGE_BORDER} text-ink/60`,
};

function PhaseCard({ phase }: { phase: RoadmapPhase }) {
  return (
    <article className="border border-ink/15 bg-paper p-6">
      <div className="flex items-center justify-between gap-4">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${STATUS_STYLES[phase.status]}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              phase.status === 'live'
                ? 'bg-lime'
                : phase.status === 'shipping'
                  ? 'bg-amber-400'
                  : 'bg-ink/30'
            }`}
          />
          {phase.statusLabel}
        </span>
      </div>
      <h3 className="mt-4 font-display text-[clamp(26px,3vw,40px)] leading-[0.98] tracking-[-0.01em]">
        {phase.title}
      </h3>
      <p className="mt-4 text-[15px] leading-relaxed text-ink/75">{phase.summary}</p>
      <ul className="mt-6 flex flex-col gap-3 text-[15px] leading-relaxed text-ink/85">
        {phase.items.map((item) => (
          <li key={item} className="border-t border-ink/10 pt-3">
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function RoadmapSnapshot() {
  return (
    <section className="bg-paper-2 text-ink px-[clamp(20px,5vw,80px)] py-[clamp(72px,9vw,128px)]">
      <div className="flex items-center justify-between border-b border-ink/15 pb-4 mb-10">
        <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">§04</span>
        <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">Roadmap</span>
      </div>

      <div className="grid md:grid-cols-12 gap-10 items-end mb-12">
        <h2 className="md:col-span-8 font-display text-[clamp(32px,4.5vw,56px)] leading-[0.95] tracking-[-0.01em]">
          Shipping the agent economy in layers.
        </h2>
        <p className="md:col-span-4 text-[16px] text-ink/75">
          Mainnet task creation and public-agent settlement are live. The lanes below cover what
          else is in production today, the production-trust and audit hand-off work shipping now,
          and what queues up after.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {roadmapPhases.map((phase) => (
          <PhaseCard key={phase.title} phase={phase} />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-6 font-mono uppercase text-[11px] tracking-[0.08em]">
        <Link href="/roadmap" className="border-b border-ink hover:text-lime hover:border-lime">
          Full roadmap →
        </Link>
        <Link href="/dashboard" className="border-b border-ink hover:text-lime hover:border-lime">
          Enter app →
        </Link>
      </div>
    </section>
  );
}
