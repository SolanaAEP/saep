import {
  fetchAllTemplates,
  fetchTemplateRegistryConfig,
} from '@saep/sdk';
import { getTemplateRegistryProgram } from '@/lib/rpc.server';
import {
  serializeTemplate,
  serializeTemplateRegistryConfig,
} from '@/lib/template-serializer';
import {
  formatTemplateRevenue,
  templateMotion,
} from '@/lib/template-marketplace';
import Link from 'next/link';
import { TemplateCatalog } from './template-catalog';

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export default async function TemplatesPage() {
  let templates = [] as ReturnType<typeof serializeTemplate>[];
  let registry: ReturnType<typeof serializeTemplateRegistryConfig> | null = null;
  let error: string | null = null;

  try {
    const program = getTemplateRegistryProgram();
    const [rawTemplates, rawRegistry] = await Promise.all([
      fetchAllTemplates(program),
      fetchTemplateRegistryConfig(program),
    ]);
    templates = rawTemplates.map(serializeTemplate);
    registry = rawRegistry ? serializeTemplateRegistryConfig(rawRegistry) : null;
  } catch (e) {
    error = (e as Error).message;
  }

  const published = templates.filter((template) => template.status === 'published').length;
  const rentable = templates.filter((template) => Number(template.rentPricePerSec) > 0).length;
  const activeForking = templates.filter((template) => template.forkCount > 0).length;
  const totalRevenue = templates.reduce((sum, template) => sum + Number(template.totalRevenue || '0'), 0);
  const hybridTemplates = templates.filter((template) => templateMotion(template) === 'hybrid').length;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            02 // template marketplace
          </div>
          <h1 className="font-display text-2xl tracking-tight">Templates</h1>
          <p className="text-sm text-mute mt-1">
            Discover reusable agent templates, compare rental versus fork economics, and move from
            a trust-ranked capability need to a launchable starting point.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end sm:text-right">
          <div className="font-mono text-[10px] text-mute sm:text-right leading-relaxed">
            <div>{registry ? 'REGISTRY LIVE' : 'REGISTRY PENDING'}</div>
            <div className={registry?.paused ? 'text-yellow-500' : 'text-lime'}>
              {published} PUBLISHED / {templates.length} TOTAL
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Link
              href="/templates/simulator"
              className="inline-flex items-center justify-center border border-lime/30 bg-lime/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-lime transition-colors hover:border-lime/50 hover:bg-lime/15"
            >
              Simulate before deploy
            </Link>
            <Link
              href="/agents/leaderboard?capability=2"
              className="inline-flex items-center justify-center border border-ink/15 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink transition-colors hover:border-ink/35 hover:bg-ink/5"
            >
              Open trust leaderboard
            </Link>
          </div>
        </div>
      </header>

      {error && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm text-danger font-mono">ERR: {error}</p>
        </div>
      )}

      {registry && (
        <div className="grid gap-4 md:grid-cols-4 border border-ink/10 p-4">
          <div>
            <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Status</div>
            <div className={registry.paused ? 'text-yellow-500 text-sm mt-1' : 'text-lime text-sm mt-1'}>
              {registry.paused ? 'Paused' : 'Accepting templates'}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Royalty Cap</div>
            <div className="text-sm mt-1">{formatBps(registry.royaltyCapBps)}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Platform Fee</div>
            <div className="text-sm mt-1">{formatBps(registry.platformFeeBps)}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] text-mute uppercase tracking-widest">Escrow Mint</div>
            <div className="text-sm mt-1 font-mono truncate">{registry.rentEscrowMint}</div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Rentable templates"
          value={String(rentable)}
          detail="Templates with non-zero lease pricing ready for recurring demand."
        />
        <SummaryCard
          label="Fork-active"
          value={String(activeForking)}
          detail="Listings that already have at least one live branch in the lineage."
        />
        <SummaryCard
          label="Hybrid patterns"
          value={String(hybridTemplates)}
          detail="Templates showing both lease traction and forking demand."
        />
        <SummaryCard
          label="Recorded revenue"
          value={formatTemplateRevenue(String(totalRevenue))}
          detail="On-chain template revenue flowing through rentals and royalty rails."
        />
      </div>

      <div className="grid gap-4 border border-ink/10 bg-paper p-4 lg:grid-cols-3">
        <BuilderStep
          eyebrow="1 // discover"
          title="Find a capability fit"
          description="Filter templates by capability, economic model, and traction to narrow the field fast."
        />
        <BuilderStep
          eyebrow="2 // stress test"
          title="Simulate before you fork"
          description="Open the economics sandbox to compare rent versus fork assumptions before you commit."
        />
        <BuilderStep
          eyebrow="3 // launch with context"
          title="Jump into trust surfaces"
          description="Open the matching marketplace or capability leaderboard directly from each template to see live operator demand."
        />
      </div>

      <TemplateCatalog initialTemplates={templates} />
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border border-ink/10 bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{label}</div>
      <div className="mt-2 font-display text-2xl tracking-tight">{value}</div>
      <p className="mt-2 text-sm text-ink/60">{detail}</p>
    </div>
  );
}

function BuilderStep({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{eyebrow}</div>
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      <p className="text-sm leading-6 text-ink/65">{description}</p>
    </div>
  );
}
