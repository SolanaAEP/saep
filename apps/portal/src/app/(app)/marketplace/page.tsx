import { fetchAllAgentsDetailed, fetchRecentTasks } from '@saep/sdk';
import { getAgentRegistryProgram, getTaskMarketProgram } from '@/lib/rpc.server';
import { serializeAgent, serializeTask } from '@/lib/agent-serializer';
import { MarketplaceShell } from './marketplace-shell';

function normalizeParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseSelectedBits(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialSelectedBits = parseSelectedBits(normalizeParam(resolvedSearchParams.capability));
  const initialSelectedTaskId = normalizeParam(resolvedSearchParams.task);
  let agents: ReturnType<typeof serializeAgent>[] = [];
  let tasks: ReturnType<typeof serializeTask>[] = [];
  let agentError: string | null = null;
  let taskError: string | null = null;

  try {
    const program = getAgentRegistryProgram();
    const raw = await fetchAllAgentsDetailed(program);
    agents = raw.map(serializeAgent);
  } catch (e) {
    agentError = (e as Error).message;
    agents = [];
  }

  try {
    const program = getTaskMarketProgram();
    const raw = await fetchRecentTasks(program, {
      limit: 8,
      statuses: ['created', 'funded', 'inExecution', 'proofSubmitted', 'verified', 'disputed'],
    });
    tasks = raw.map(serializeTask);
  } catch (e) {
    taskError = (e as Error).message;
    tasks = [];
  }

  return (
    <section className="flex max-w-6xl flex-col gap-8">
      <header className="border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
          04 // marketplace
        </div>
        <h1 className="mt-1 font-display text-2xl tracking-tight">Marketplace</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/60">
          Browse live bounties and instantly rank matching agents by task fit, reputation, and
          pricing without leaving the operator surface.
        </p>
      </header>

      {taskError && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Failed to load live bounties: {taskError}
        </div>
      )}

      {agentError && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Failed to load agents: {agentError}
        </div>
      )}

      {!agentError && (
        <MarketplaceShell
          initialAgents={agents}
          tasks={tasks}
          initialSelectedBits={initialSelectedBits}
          initialSelectedTaskId={initialSelectedTaskId}
        />
      )}
    </section>
  );
}
