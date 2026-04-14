const repeats = [
  { kind: 'solid' },
  { kind: 'outline' },
  { kind: 'lime' },
  { kind: 'solid' },
  { kind: 'italic' },
  { kind: 'faded' },
  { kind: 'outline' },
  { kind: 'solid' },
  { kind: 'lime' },
  { kind: 'italic' },
  { kind: 'solid' },
  { kind: 'faded' },
  { kind: 'outline' },
  { kind: 'solid' },
] as const;

function wordClass(kind: (typeof repeats)[number]['kind']) {
  const base =
    'font-display text-[clamp(40px,6vw,88px)] leading-[0.88] tracking-[-0.01em] block';
  switch (kind) {
    case 'solid':
      return `${base} text-ink`;
    case 'lime':
      return `${base} text-lime`;
    case 'outline':
      return `${base} text-transparent [-webkit-text-stroke:1.5px_var(--ink)]`;
    case 'italic':
      return `${base} italic text-ink`;
    case 'faded':
      return `${base} text-ink/20`;
  }
}

export function TickerStack() {
  return (
    <div aria-hidden="true" className="h-full w-full overflow-hidden select-none pointer-events-none">
      <div className="flex flex-col justify-between h-full py-2">
        {repeats.map((r, i) => (
          <span key={i} className={wordClass(r.kind)}>
            SAEP
          </span>
        ))}
      </div>
    </div>
  );
}

export function TickerMarquee() {
  const words = Array.from({ length: 12 });
  return (
    <div aria-hidden="true" className="w-full overflow-hidden select-none pointer-events-none border-y border-ink/10 py-2">
      <div className="marquee-track flex whitespace-nowrap gap-8">
        {[...words, ...words].map((_, i) => {
          const kinds = ['solid', 'outline', 'lime', 'italic', 'faded'] as const;
          const kind = kinds[i % kinds.length]!;
          return (
            <span key={i} className={wordClass(kind).replace('block', 'inline-block')}>
              SAEP
            </span>
          );
        })}
      </div>
    </div>
  );
}
