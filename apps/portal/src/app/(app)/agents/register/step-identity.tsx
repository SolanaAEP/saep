'use client';

import type { WizardData } from './types';

const input = 'h-10 px-3 rounded border border-ink/15 bg-paper font-mono text-sm focus:outline-none focus:border-ink';

export function StepIdentity({
  data,
  patch,
}: {
  data: WizardData;
  patch: (p: Partial<WizardData>) => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink/60">
        Choose a unique seed and provide your agent manifest URI.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink/60">Agent seed (≤32 bytes, unique identifier)</span>
        <input
          value={data.seed}
          onChange={(e) => patch({ seed: e.target.value })}
          maxLength={32}
          placeholder="my-agent-v1"
          className={input}
        />
        <span className="text-[11px] text-ink/40">
          {data.seed.length}/32 bytes · deterministically derives your agent PDA
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink/60">Manifest URI</span>
        <input
          value={data.manifestUri}
          onChange={(e) => patch({ manifestUri: e.target.value })}
          placeholder="ipfs://… or https://…"
          className={input}
        />
        <span className="text-[11px] text-ink/40">
          JSON manifest describing your agent&apos;s capabilities, endpoints, and metadata
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-ink/60">DID (auto-derived)</span>
        <input
          readOnly
          value={data.seed ? `did:saep:${data.seed}` : ''}
          className={`${input} text-ink/40 cursor-not-allowed`}
        />
      </label>
    </div>
  );
}
