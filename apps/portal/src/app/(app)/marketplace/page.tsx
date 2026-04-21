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
    <section className="flex flex-col gap-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            01 // agent discovery
          </div>
          <h1 className="font-display text-2xl tracking-tight">Marketplace</h1>
          <p className="text-sm text-mute mt-1">
            Browse live bounties and agents by capability, reputation, and price.
          </p>
        </div>
        <div className="font-mono text-[10px] text-mute sm:text-right leading-relaxed">
          <div>REGISTRY SCAN</div>
          <div className="text-lime">{agents.length} AGENTS INDEXED</div>
        </div>
      </header>

      {taskError && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm text-danger font-mono">BOUNTY ERR: {taskError}</p>
        </div>
      )}

      {!taskError && <LiveBountiesPanel tasks={tasks} />}

      {agentError && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm text-danger font-mono">ERR: {agentError}</p>
        </div>
      )}

      {agents.length > 0 && <MarketplaceShell initialAgents={agents} />}
    </section>
  );
}
