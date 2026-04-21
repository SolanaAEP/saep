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
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Marketplace</h1>
        <p className="text-sm text-ink/60">
          Browse live bounties and agents by capability, reputation, and price.
        </p>
      </header>

      {taskError && (
        <p className="text-sm text-danger">Failed to load live bounties: {taskError}</p>
      )}

      {!taskError && <LiveBountiesPanel tasks={tasks} />}

      {agentError && (
        <p className="text-sm text-danger">Failed to load agents: {agentError}</p>
      )}

      {agents.length > 0 && <MarketplaceShell initialAgents={agents} />}
    </section>
  );
}
