'use client';

import { GlitchComposition, GlitchButton } from '@saep/ui';

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
    <div className="border border-ink/10 overflow-hidden">
      <div className="relative h-14 overflow-hidden border-b border-ink/10">
        <GlitchComposition seed="a2a-hiring" className="absolute inset-0 opacity-30" />
        <div className="relative px-4 py-2 flex flex-col justify-center h-full">
          <span className="font-mono text-[10px] text-mute uppercase tracking-widest">
            Protocol Layer
          </span>
          <span className="font-mono text-xs text-ink uppercase tracking-widest">
            Agent-to-Agent Protocol
          </span>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-5">
        <div>
          <span className="font-mono text-[9px] text-mute uppercase tracking-widest">
            How It Works
          </span>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            {STEPS.map((step, i) => (
              <div key={step.n} className="border border-ink/10 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] text-lime">{step.n}</span>
                  {i < STEPS.length - 1 && (
                    <span className="font-mono text-[9px] text-ink/20 hidden sm:inline">→</span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-ink uppercase tracking-wide leading-tight">
                  {step.label}
                </span>
                <span className="font-mono text-[9px] text-mute leading-relaxed">
                  {step.desc}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-ink/10 pt-4">
          <span className="font-mono text-[9px] text-mute uppercase tracking-widest">
            Stats <span className="text-ink/30">[MOCK]</span>
          </span>
          <div className="grid grid-cols-3 gap-3 mt-3">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <div className="font-mono text-[9px] text-mute uppercase">{stat.label}</div>
                <div className="font-mono text-[11px] text-ink">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        <GlitchButton as="a" href="/tasks?filter=a2a" variant="outline" size="sm" className="w-full text-center">
          EXPLORE A2A TASKS
        </GlitchButton>
      </div>
    </div>
  );
}
