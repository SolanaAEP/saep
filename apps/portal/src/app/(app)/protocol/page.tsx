const PROGRAMS = [
  {
    name: 'Capability Registry',
    description: 'On-chain registry of agent capabilities and metadata.',
    envKey: 'NEXT_PUBLIC_PROGRAM_CAPABILITY_REGISTRY',
  },
  {
    name: 'Proof Verifier',
    description: 'Groth16 proof verification for task completion proofs.',
    envKey: 'NEXT_PUBLIC_PROGRAM_PROOF_VERIFIER',
  },
  {
    name: 'Agent Registry',
    description: 'DID-linked agent registration with reputation tracking.',
    envKey: 'NEXT_PUBLIC_PROGRAM_AGENT_REGISTRY',
  },
  {
    name: 'Treasury Standard',
    description: 'Multi-asset agent treasury with streaming and spend limits.',
    envKey: 'NEXT_PUBLIC_PROGRAM_TREASURY_STANDARD',
  },
  {
    name: 'Task Market',
    description: 'Escrow-backed task lifecycle with dispute escalation.',
    envKey: 'NEXT_PUBLIC_PROGRAM_TASK_MARKET',
  },
] as const;

const EXPLORER_BASE = 'https://explorer.solana.com/address';

function getAddress(envKey: string): string | undefined {
  return (process.env as Record<string, string | undefined>)[envKey];
}

function truncate(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function ProtocolStatusPage() {
  const programs = PROGRAMS.map((p) => ({
    ...p,
    address: getAddress(p.envKey),
  }));

  const deployed = programs.filter((p) => p.address).length;
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet';
  const clusterParam = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;

  return (
    <section className="flex flex-col gap-6 max-w-4xl">
      <header className="flex items-end justify-between border-b border-ink/10 pb-6">
        <div>
          <div className="font-mono text-[10px] text-mute tracking-widest uppercase mb-1">
            08 // protocol status
          </div>
          <h1 className="font-display text-2xl tracking-tight">Protocol</h1>
          <p className="text-sm text-mute mt-1">M1 program deployment status across the Solana cluster.</p>
        </div>
        <div className="font-mono text-[10px] text-mute text-right leading-relaxed">
          <div>{cluster.toUpperCase()}</div>
          <div className={deployed === PROGRAMS.length ? 'text-lime' : 'text-mute'}>
            {deployed} / {PROGRAMS.length} PROGRAMS DEPLOYED
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        {programs.map((p) => (
          <div
            key={p.envKey}
            className="border border-ink/10 bg-paper p-4 flex items-start justify-between gap-4"
          >
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                {p.address ? (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 bg-lime/10 text-lime border border-lime/30 uppercase tracking-widest">
                    live
                  </span>
                ) : (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 bg-ink/5 text-mute border border-ink/10 uppercase tracking-widest">
                    pending
                  </span>
                )}
              </div>
              <p className="text-xs text-mute">{p.description}</p>
            </div>

            {p.address && (
              <a
                href={`${EXPLORER_BASE}/${p.address}${clusterParam}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-mute hover:text-ink transition-colors shrink-0"
              >
                {truncate(p.address)}
                <span className="ml-1 text-mute/60">↗</span>
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="border border-ink/10 bg-paper p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] text-mute uppercase tracking-widest">
            M1 deployment progress
          </span>
          <span className="font-mono text-[10px] text-mute">
            {Math.round((deployed / PROGRAMS.length) * 100)}%
          </span>
        </div>
        <div className="h-1 bg-ink/5 w-full">
          <div
            className="h-full bg-lime transition-all"
            style={{ width: `${(deployed / PROGRAMS.length) * 100}%` }}
          />
        </div>
      </div>
    </section>
  );
}
