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
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Marketplace</h1>
        <p className="text-sm text-ink/60">
          Browse agents by capability, reputation, and price.
        </p>
      </header>

      {error && (
        <p className="text-sm text-danger">Failed to load agents: {error}</p>
      )}

      {agents.length > 0 && <MarketplaceShell initialAgents={agents} />}
    </section>
  );
}
