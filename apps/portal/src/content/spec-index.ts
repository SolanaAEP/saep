export type SpecEntry = {
  slug: string;
  title: string;
  kind: 'program' | 'circuit' | 'service' | 'ops' | 'overview' | 'tokenomics';
  summary: string;
  file: string;
};

export const specIndex: readonly SpecEntry[] = [
  {
    slug: 'overview',
    title: 'Overview',
    kind: 'overview',
    summary:
      'Phase breakdown, milestone scope, parallelization plan, and open questions surfaced to operators.',
    file: '00-overview.md',
  },
  {
    slug: 'repo-bootstrap',
    title: 'Repo & monorepo bootstrap',
    kind: 'ops',
    summary:
      'Protocol workspace, CI pipeline, and local development harness — the substrate every other spec assumes.',
    file: '01-repo-monorepo-bootstrap.md',
  },
  {
    slug: 'capability-registry',
    title: 'CapabilityRegistry program',
    kind: 'program',
    summary:
      'Governance-gated bitmask of approved agent capabilities. Source of truth for what AgentRegistry will accept.',
    file: '02-program-capability-registry.md',
  },
  {
    slug: 'agent-registry',
    title: 'AgentRegistry program',
    kind: 'program',
    summary:
      'On-chain identity for agents: DID, capability mask, pricing, reputation, staking, 30-day slash timelock.',
    file: '03-program-agent-registry.md',
  },
  {
    slug: 'treasury-standard',
    title: 'TreasuryStandard program',
    kind: 'program',
    summary:
      'Per-agent PDA wallets with spend limits, streaming budgets, allowlists, and Token-2022-aware transfers.',
    file: '04-program-treasury-standard.md',
  },
  {
    slug: 'task-completion-circuit',
    title: 'Task-completion circuit',
    kind: 'circuit',
    summary:
      'Circom 2.0 circuit that proves a task’s acceptance predicate held against committed inputs.',
    file: '05-circuit-task-completion.md',
  },
  {
    slug: 'proof-verifier',
    title: 'ProofVerifier program',
    kind: 'program',
    summary:
      'On-chain Groth16 verification via Light Protocol, with binding back to TaskMarket settlement.',
    file: '06-program-proof-verifier.md',
  },
  {
    slug: 'task-market',
    title: 'TaskMarket program',
    kind: 'program',
    summary:
      'The state machine: create, fund, claim, submit, settle, refund. Jito-bundle-atomic create+fund.',
    file: '07-program-task-market.md',
  },
  {
    slug: 'iacp-bus',
    title: 'IACP message bus',
    kind: 'service',
    summary:
      'Inter-Agent Communication Protocol over Redis Streams and WebSockets. The live-settlement feed.',
    file: '08-iacp-bus.md',
  },
  {
    slug: 'proof-gen-service',
    title: 'Proof generation service',
    kind: 'service',
    summary:
      'NestJS + Bull queue + GPU worker. Turns a task transcript into a Groth16 witness and proof.',
    file: '09-proof-gen-service.md',
  },
  {
    slug: 'squads-multisig',
    title: 'Squads multisig authority model',
    kind: 'ops',
    summary:
      'Public authority split for upgrades, governance changes, and emergency controls, with verifiable handover targets.',
    file: 'ops-squads-multisig.md',
  },
  {
    slug: 'trusted-setup',
    title: 'Trusted setup public policy',
    kind: 'ops',
    summary:
      'Public acceptance criteria and artifact requirements for any production Groth16 setup used by SAEP.',
    file: 'ops-trusted-setup.md',
  },
  {
    slug: 'token2022-saep-mint',
    title: 'Token-2022 SAEP mint (post-launch)',
    kind: 'tokenomics',
    summary:
      'Live mint contract: pump.fun-launched, 6 decimals, ~1B fixed supply, fully renounced authorities, only metadataPointer + tokenMetadata extensions. RPC verification snippet included.',
    file: 'token2022-saep-mint.md',
  },
  {
    slug: 'tokenomics-activation',
    title: 'Tokenomics activation',
    kind: 'tokenomics',
    summary:
      'CPI-driven protocol economy that wraps the renounced mint: settlement-time fees, distribution rewards, buyback-and-burn, retro vesting. The architecture that replaces the aspirational TransferHook design.',
    file: 'tokenomics-activation.md',
  },
] as const;

export const specBySlug = new Map<string, SpecEntry>(
  specIndex.map((s) => [s.slug, s])
);
