export function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="border border-ink p-5 bg-paper-2">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-display text-4xl leading-none">{value}</span>
        {unit ? (
          <span className="font-mono text-xs text-mute-2">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}
