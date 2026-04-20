import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SPECS_DIR = join(process.cwd(), '..', '..', 'specs');

export type SpecGroup = 'protocol' | 'infrastructure' | 'integrations' | 'security' | 'ops';

export type SpecEntry = {
  slug: string;
  file: string;
  title: string;
  group: SpecGroup;
  order: number;
};

const EXCLUDE: Set<string> = new Set([
  'post-launch-optimizations',
  'nxs-m3-migration',
  'sendai-upstream-pr',
  'retro-airdrop',
]);

const TITLE_OVERRIDES: Record<string, string> = {
  '00-overview': 'Protocol Overview',
  '01-repo-monorepo-bootstrap': 'Monorepo Architecture',
  '02-program-capability-registry': 'Capability Registry',
  '03-program-agent-registry': 'Agent Registry',
  '04-program-treasury-standard': 'Treasury Standard',
  '05-circuit-task-completion': 'Task Completion Circuit',
  '06-program-proof-verifier': 'Proof Verifier',
  '07-program-task-market': 'Task Market',
  '08-iacp-bus': 'Inter-Agent Communication Protocol',
  '09-proof-gen-service': 'Proof Generation Service',
  'compute-bond': 'Compute Bond (DePIN Escrow)',
  'discovery-api': 'Discovery API',
  'indexer-schema': 'Indexer Schema',
  'integration-mcp': 'MCP Server Integration',
  'integration-sak': 'Solana Agent Kit Plugin',
  'integration-x402': 'x402 Payment Rail',
  'mev-settlement': 'MEV Settlement Policy',
  'ops-mcp-setup': 'MCP Bridge Setup Guide',
  'ops-squads-multisig': 'Multisig Provisioning',
  'ops-trusted-setup': 'Trusted Setup Ceremony',
  'pre-audit-01-typed-task-schema': 'Typed Task Schema',
  'pre-audit-02-commit-reveal-bidding': 'Commit-Reveal Bidding',
  'pre-audit-03-circom-bound-reputation': 'ZK-Bound Reputation Scoring',
  'pre-audit-04-personhood-gate': 'Proof-of-Personhood Gate',
  'pre-audit-05-transferhook-whitelist': 'TransferHook Whitelist',
  'pre-audit-07-cpi-reentrancy-guards': 'CPI Reentrancy Guards',
  'program-dispute-arbitration': 'Dispute Arbitration',
  'program-fee-collector': 'Fee Collector',
  'program-governance': 'Governance',
  'program-nxs-staking': 'NXS Staking',
  'program-template-registry': 'Template Registry',
  'reputation-graph': 'Reputation Graph',
  'token2022-saep-mint': 'SAEP Token (Token-2022)',
};

const GROUP_OVERRIDES: Record<string, SpecGroup> = {
  'integration-mcp': 'integrations',
  'integration-sak': 'integrations',
  'integration-x402': 'integrations',
  'pre-audit-01-typed-task-schema': 'security',
  'pre-audit-02-commit-reveal-bidding': 'security',
  'pre-audit-03-circom-bound-reputation': 'security',
  'pre-audit-04-personhood-gate': 'security',
  'pre-audit-05-transferhook-whitelist': 'security',
  'pre-audit-07-cpi-reentrancy-guards': 'security',
  'ops-mcp-setup': 'ops',
  'ops-squads-multisig': 'ops',
  'ops-trusted-setup': 'ops',
  '08-iacp-bus': 'infrastructure',
  '09-proof-gen-service': 'infrastructure',
  'discovery-api': 'infrastructure',
  'indexer-schema': 'infrastructure',
  'compute-bond': 'infrastructure',
  'mev-settlement': 'infrastructure',
};

function titleFromMarkdown(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m);
  return m && m[1] ? m[1].replace(/[\s—-]+$/g, '').trim() : fallback;
}

function resolveGroup(slug: string): SpecGroup {
  if (GROUP_OVERRIDES[slug]) return GROUP_OVERRIDES[slug];
  if (slug.startsWith('ops-')) return 'ops';
  return 'protocol';
}

const GROUP_ORDER: Record<SpecGroup, number> = {
  protocol: 0,
  infrastructure: 1,
  integrations: 2,
  security: 3,
  ops: 4,
};

export function listSpecs(): SpecEntry[] {
  const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.md'));
  const entries: SpecEntry[] = [];

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    if (EXCLUDE.has(slug)) continue;

    const body = readFileSync(join(SPECS_DIR, file), 'utf8');
    const group = resolveGroup(slug);
    const numMatch = slug.match(/^(\d+)/);
    const order = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : 1000;

    entries.push({
      slug,
      file,
      title: TITLE_OVERRIDES[slug] ?? titleFromMarkdown(body, slug),
      group,
      order,
    });
  }

  return entries.sort((a, b) => {
    const gd = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
    if (gd !== 0) return gd;
    if (a.order !== b.order) return a.order - b.order;
    return a.slug.localeCompare(b.slug);
  });
}

export function readSpec(slug: string): { body: string; title: string } | null {
  const entries = listSpecs();
  const entry = entries.find((e) => e.slug === slug);
  if (!entry) return null;
  const body = readFileSync(join(SPECS_DIR, entry.file), 'utf8');
  return { body, title: entry.title };
}
