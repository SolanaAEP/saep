import {
  fetchAllTemplates,
  fetchTemplateRegistryConfig,
} from '@saep/sdk';
import { getTemplateRegistryProgram } from '@/lib/rpc.server';
import {
  serializeTemplate,
  serializeTemplateRegistryConfig,
} from '@/lib/template-serializer';
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

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            02 // template registry
          </div>
          <h1 className="font-display text-2xl tracking-tight">Templates</h1>
          <p className="text-sm text-mute mt-1">
            Discover reusable agent templates, rental economics, and the primitives behind template-based agent markets.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="font-mono text-[10px] text-mute sm:text-right leading-relaxed">
            <div>{registry ? 'REGISTRY LIVE' : 'REGISTRY PENDING'}</div>
            <div className={registry?.paused ? 'text-yellow-500' : 'text-lime'}>
              {published} PUBLISHED / {templates.length} TOTAL
            </div>
          </div>
          <Link
            href="/templates/simulator"
            className="inline-flex items-center justify-center border border-ink/15 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink transition-colors hover:border-lime/40 hover:bg-lime/10"
          >
            Open simulator
          </Link>
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

      <TemplateCatalog initialTemplates={templates} />
    </section>
  );
}
