import type { NetworkHealth } from '@/lib/indexer';

const fmt = new Intl.NumberFormat('en-US');

function status(reorgs: number, eventsPerMin: number): {
  label: string;
  tone: 'good' | 'warn' | 'bad';
} {
  if (reorgs > 5) return { label: 'Degraded', tone: 'bad' };
  if (eventsPerMin === 0) return { label: 'Idle', tone: 'warn' };
  return { label: 'Nominal', tone: 'good' };
}

const TONE: Record<'good' | 'warn' | 'bad', string> = {
  good: 'bg-[#cbff3a] text-ink',
  warn: 'bg-[#ffd23a] text-ink',
  bad: 'bg-[#ff5a3a] text-paper',
};

export function NetworkHealthPanel({ data }: { data: NetworkHealth }) {
  const s = status(data.reorgs24h, data.eventsPerMin);
  return (
    <div className="border border-ink p-5">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
          Network health
        </div>
        <span
          className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${TONE[s.tone]}`}
        >
          {s.label}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-[11px] uppercase tracking-[0.08em]">
        <Row label="Latest slot" value={fmt.format(data.latestSlot)} />
        <Row label="Reorgs · 24h" value={fmt.format(data.reorgs24h)} />
        <Row label="Events / min" value={fmt.format(data.eventsPerMin)} />
        <Row label="Events · total" value={fmt.format(data.eventsTotal)} />
        <Row label="Blocks · total" value={fmt.format(data.blocksTotal)} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-mute-2">{label}</dt>
      <dd className="mt-1 text-base normal-case tracking-normal">{value}</dd>
    </div>
  );
}
