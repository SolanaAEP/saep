import { fetchAgentByDid, fetchTasksByAgent } from '@saep/sdk';
import { getAgentRegistryProgram, getTaskMarketProgram } from '@/lib/rpc.server';
import { serializeAgent, serializeTask } from '@/lib/agent-serializer';
import { sanitize } from '@/lib/sanitize';
import { maskToTags } from '../../dashboard/capability-tags';
import { ManifestViewer } from './manifest-viewer';
import { ReputationRadar } from './reputation-radar';
import { JobHistoryTable } from './job-history-table';
import { AgentDetailShell } from './agent-detail-shell';

const STATUS_COLOR: Record<string, string> = {
  active: 'text-lime bg-lime/10',
  paused: 'text-yellow-500 bg-yellow-500/10',
  suspended: 'text-danger bg-danger/10',
  deregistered: 'text-mute bg-mute/10',
};

function fmtSol(lamports: string): string {
  return `${(Number(lamports) / 1e9).toFixed(2)}`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ did: string }>;
}) {
  const { did } = await params;

  let agent;
  let tasks;

  try {
    const registryProgram = getAgentRegistryProgram();
    const raw = await fetchAgentByDid(registryProgram, did);
    if (!raw) {
      return (
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl tracking-tight">Agent not found</h1>
          <p className="font-mono text-[11px] text-mute">
            No agent with DID {did.slice(0, 16)}…
          </p>
        </div>
      );
    }
    agent = serializeAgent(raw);

    const taskProgram = getTaskMarketProgram();
    const rawTasks = await fetchTasksByAgent(taskProgram, did);
    tasks = rawTasks.map(serializeTask);
  } catch (e) {
    return (
      <div className="font-mono text-[11px] text-danger border border-danger/30 bg-danger/5 px-3 py-2">ERR: {(e as Error).message}</div>
    );
  }

  const tags = maskToTags(BigInt(agent.capabilityMask));

  return (
    <section className="flex flex-col gap-6 max-w-4xl">
      <header className="flex flex-col gap-2 border-b border-ink/10 pb-6">
        <div className="font-mono text-[10px] text-mute tracking-widest uppercase">
          agent // {did.slice(0, 12)}
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl tracking-tight">
            {sanitize(agent.manifestUri) || `Agent ${did.slice(0, 8)}…`}
          </h1>
          <span
            className={`text-[10px] font-mono uppercase px-1.5 py-0.5 border ${STATUS_COLOR[agent.status] ?? ''}`}
          >
            {agent.status}
          </span>
        </div>
        <p className="text-xs font-mono text-ink/50">{did}</p>
      </header>

      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
        <div>
          <dt className="text-ink/50">Operator</dt>
          <dd className="font-mono truncate">{agent.operator}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Stake</dt>
          <dd className="font-mono">{fmtSol(agent.stakeAmount)} SOL</dd>
        </div>
        <div>
          <dt className="text-ink/50">Price</dt>
          <dd className="font-mono">{fmtSol(agent.priceLamports)} SOL</dd>
        </div>
        <div>
          <dt className="text-ink/50">Jobs</dt>
          <dd>{agent.jobsCompleted}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Registered</dt>
          <dd>{fmtDate(agent.registeredAt)}</dd>
        </div>
      </dl>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="text-[10px] px-2 py-0.5 bg-ink/5 text-ink/70">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ManifestViewer uri={agent.manifestUri} />
        <ReputationRadar reputation={agent.reputation} />
      </div>

      <AgentDetailShell didHex={did}>
        <JobHistoryTable tasks={tasks} />
      </AgentDetailShell>
    </section>
  );
}
