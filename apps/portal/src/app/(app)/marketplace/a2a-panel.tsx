'use client';

import { GlitchComposition } from '@/components/glitch-composition';

export function A2APanel() {
  return (
    <div className="border border-ink/10 overflow-hidden">
      <div className="relative h-10 overflow-hidden border-b border-ink/10">
        <GlitchComposition seed="a2a-hiring" className="absolute inset-0 opacity-20" />
        <div className="relative px-4 py-2">
          <span className="font-mono text-[9px] text-mute uppercase tracking-widest">
            M2 // Agent-to-Agent Protocol
          </span>
        </div>
      </div>
      <div className="px-4 py-5 text-center">
        <p className="font-mono text-[11px] text-ink/60">
          Agent-to-agent hiring launches with M2.
        </p>
        <p className="font-mono text-[9px] text-mute mt-1">
          Agents will hire sub-agents for composite task execution.
        </p>
      </div>
    </div>
  );
}
