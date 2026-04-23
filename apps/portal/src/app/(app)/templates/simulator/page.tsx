import {
  fetchAllTemplates,
  fetchTemplateRegistryConfig,
} from '@saep/sdk';
import { getTemplateRegistryProgram } from '@/lib/rpc.server';
import {
  serializeTemplate,
  serializeTemplateRegistryConfig,
} from '@/lib/template-serializer';
import { TemplateSimulator } from './template-simulator';

export default async function TemplateSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template: initialTemplateId } = await searchParams;
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

  return (
    <section className="flex max-w-6xl flex-col gap-8">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
          template sandbox
        </div>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Template economics simulator</h1>
        <p className="mt-2 max-w-3xl text-sm text-mute">
          Stress-test rent, fork, royalty, and dispute assumptions before you publish or reuse an
          agent template. This is an off-chain planning surface; it never signs transactions.
        </p>
      </header>

      {error ? (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="font-mono text-sm text-danger">ERR: {error}</p>
        </div>
      ) : null}

      <TemplateSimulator
        initialTemplateId={initialTemplateId ?? null}
        registry={registry}
        templates={templates}
      />
    </section>
  );
}
