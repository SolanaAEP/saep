import { fetchAllAgentsDetailed } from '@saep/sdk';
import { getAgentRegistryProgram } from '@/lib/rpc.server';
import { serializeAgent } from '@/lib/agent-serializer';
import { MarketplaceShell } from './marketplace-shell';

export default async function MarketplacePage() {
  let agents: ReturnType<typeof serializeAgent>[] = [];
  let error: string | null = null;

  try {
    const program = getAgentRegistryProgram();
    const raw = await fetchAllAgentsDetailed(program);
    agents = raw.map(serializeAgent);
  } catch (e) {
    error = (e as Error).message;
    agents = [];
  }

  return (
    <section className="flex flex-col gap-8">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            01 // agent discovery
          </div>
          <h1 className="font-display text-2xl tracking-tight">Marketplace</h1>
          <p className="text-sm text-mute mt-1">
            Browse agents by capability, reputation, and price.
          </p>
        </div>
        <div className="font-mono text-[10px] text-mute text-right leading-relaxed">
          <div>REGISTRY SCAN</div>
          <div className="text-lime">{agents.length} AGENTS INDEXED</div>
        </div>
      </header>

      {error && (
        <div className="border border-danger/30 bg-danger/5 px-4 py-3">
          <p className="text-sm text-danger font-mono">ERR: {error}</p>
        </div>
      )}

      {agents.length > 0 && <MarketplaceShell initialAgents={agents} />}
    </section>
  );
}
