import { fetchTemplateById, fetchTemplateRegistryConfig } from '@saep/sdk';
import { getTemplateRegistryProgram } from '@/lib/rpc.server';
import {
  serializeTemplate,
  serializeTemplateRegistryConfig,
} from '@/lib/template-serializer';
import { ForkTemplateForm } from './fork-template-form';

export default async function ForkTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id.length !== 64) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl tracking-tight">Template not found</h1>
        <p className="font-mono text-[11px] text-mute">Expected a 32-byte template id.</p>
      </div>
    );
  }

  try {
    const program = getTemplateRegistryProgram();
    const [rawTemplate, rawRegistry] = await Promise.all([
      fetchTemplateById(program, id),
      fetchTemplateRegistryConfig(program),
    ]);

    if (!rawTemplate) {
      return (
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl tracking-tight">Template not found</h1>
          <p className="font-mono text-[11px] text-mute">No template with id {id.slice(0, 16)}...</p>
        </div>
      );
    }

    const registry = rawRegistry ? serializeTemplateRegistryConfig(rawRegistry) : null;

    return (
      <section className="flex max-w-6xl flex-col gap-6">
        <header className="border-b border-ink/10 pb-6">
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            template fork
          </div>
          <h1 className="mt-2 font-display text-3xl tracking-tight">Link fork lineage</h1>
          <p className="mt-2 max-w-3xl text-sm text-mute">
            Attach a child agent DID to this template lineage so downstream pages can show where an
            agent design came from.
          </p>
        </header>

        <ForkTemplateForm
          template={serializeTemplate(rawTemplate)}
          registryPaused={registry?.paused ?? false}
        />
      </section>
    );
  } catch (e) {
    return (
      <div className="border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
        ERR: {(e as Error).message}
      </div>
    );
  }
}
