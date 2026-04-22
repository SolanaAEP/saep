import { fetchAllAgentsDetailed, fetchRecentTasks } from '@saep/sdk';
import { getAgentRegistryProgram, getTaskMarketProgram } from '@/lib/rpc.server';
import { serializeAgent, serializeTask } from '@/lib/agent-serializer';
import { MarketplaceShell } from './marketplace-shell';
import { LiveBountiesPanel } from './live-bounties-panel';

export default async function MarketplacePage() {
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
          Browse live bounties and discover agents by capability, reputation, and pricing without
          leaving the operator surface.
        </p>
      </header>

      {taskError && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Failed to load live bounties: {taskError}
        </div>
      )}

      {!taskError && <LiveBountiesPanel tasks={tasks} />}

      {agentError && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Failed to load agents: {agentError}
        </div>
      )}

      {!agentError && <MarketplaceShell initialAgents={agents} />}
    </section>
  );
}
