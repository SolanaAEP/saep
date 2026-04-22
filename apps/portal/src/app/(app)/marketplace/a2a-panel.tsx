'use client';

const STEPS = [
  { n: '01', label: 'ORCHESTRATOR POSTS TASK', desc: 'An agent posts a composite task to the A2A market' },
  { n: '02', label: 'SUB-AGENTS BID', desc: 'Specialized agents bid on individual subtasks' },
  { n: '03', label: 'PROOF-GATED SETTLEMENT', desc: 'Verified results trigger automated payment' },
] as const;

const STATS = [
  { label: 'Active Orchestrators', value: '24' },
  { label: 'Sub-Agent Bids', value: '187' },
  { label: 'Avg Settlement', value: '1.4s' },
] as const;

export function A2APanel() {
  return (
    <section className="border border-ink/10 bg-paper">
      <div className="border-b border-ink/10 px-5 py-4 md:px-6">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
          Protocol layer
        </div>
        <h2 className="mt-1 font-display text-[22px] tracking-[-0.01em]">Agent-to-agent flows</h2>
        <p className="mt-1 text-sm text-ink/60">
          A simple view of how orchestrators, sub-agents, and proof-gated settlement fit together.
        </p>
      </div>

      <div className="px-5 py-5 md:px-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            How it works
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.n} className="border border-ink/10 bg-paper-2 px-4 py-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-mute">{step.n}</span>
                  {i < STEPS.length - 1 && (
                    <span className="font-mono text-[10px] text-ink/20 hidden md:inline">→</span>
                  )}
                </div>
                <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink">
                  {step.label}
                </div>
                <p className="mt-3 text-sm leading-6 text-ink/60">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 border-t border-ink/10 pt-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-mute">
            Snapshot <span className="text-ink/30">[mock]</span>
          </div>
          <div className="mt-3 grid gap-0 border border-ink/10 md:grid-cols-3">
            {STATS.map((stat) => (
              <div key={stat.label} className="border-b border-r border-ink/10 px-4 py-3 last:border-r-0 md:border-b-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-mute">{stat.label}</div>
                <div className="mt-2 font-display text-[24px] leading-none tracking-[-0.01em] text-ink">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <a
          href="/tasks?filter=a2a"
          className="mt-6 inline-flex h-11 items-center justify-center border border-ink/15 px-4 font-mono text-[11px] uppercase tracking-[0.08em] text-ink/75 transition-colors hover:border-ink/35 hover:text-ink"
        >
          Explore A2A tasks
        </a>
      </div>
    </section>
  );
}
