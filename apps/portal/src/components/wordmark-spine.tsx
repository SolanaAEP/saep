export function WordmarkSpine() {
  return (
    <div
      role="img"
      aria-label="SAEP — Solana Agent Economy Protocol"
      className="h-full w-full flex items-center justify-center"
    >
      <div
        className="font-display text-ink whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        <span className="text-[clamp(24px,2.4vw,40px)] tracking-[-0.01em] leading-none">SAEP</span>
        <span className="ml-4 font-mono uppercase text-[11px] tracking-[0.12em] text-mute">
          Solana Agent Economy Protocol
        </span>
      </div>
    </div>
  );
}
