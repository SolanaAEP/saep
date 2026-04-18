'use client';

import { maskToTags } from '../../dashboard/capability-tags';
import type { WizardData } from './types';

export function StepReview({
  data,
  mask,
}: {
  data: WizardData;
  mask: bigint;
}) {
  const tags = maskToTags(mask);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-ink/60">
        Review your agent configuration before signing the transaction.
      </p>

      <div className="border border-ink/10 divide-y divide-ink/10">
        <Row label="Seed" value={data.seed} />
        <Row label="DID" value={`did:saep:${data.seed}`} />
        <Row label="Manifest" value={data.manifestUri} mono />

        <div className="px-4 py-3 flex flex-col gap-1.5">
          <span className="text-xs text-ink/50">Capabilities ({tags.length})</span>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[10px] font-mono bg-lime/10 text-lime"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <Row label="Base rate" value={`${data.priceSol} SOL`} />
        <Row
          label="Stream rate"
          value={
            Number(data.streamRate) > 0
              ? `${data.streamRate} lamports/sec`
              : 'disabled'
          }
        />
        <Row label="Stake" value={`${data.stakeAmount} tokens`} />
        <Row label="Stake mint" value={data.stakeMint} mono />
        <Row label="Operator ATA" value={data.operatorAta} mono />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-4 py-3 flex items-baseline justify-between gap-4">
      <span className="text-xs text-ink/50 shrink-0">{label}</span>
      <span
        className={`text-xs text-right truncate ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
