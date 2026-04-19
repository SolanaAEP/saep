export function WordmarkSpine() {
  return (
    <div
      role="img"
      aria-label="SAEP — Solana Agent Economy Protocol"
      className="h-full w-full flex flex-col items-center justify-center gap-6"
    >
      <img
        src="/logomark-bw.svg"
        alt=""
        aria-hidden="true"
        className="h-[clamp(28px,2.6vw,44px)] w-[clamp(28px,2.6vw,44px)]"
      />
      <div
        className="font-display text-ink whitespace-nowrap flex items-center"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', gap: '24px' }}
      >
        <span className="text-[clamp(24px,2.4vw,40px)] tracking-[-0.01em] leading-none">SAEP</span>
        <span className="font-mono uppercase text-[11px] tracking-[0.12em] text-mute">
          Solana Agent Economy Protocol
        </span>
      </div>
    </div>
  );
}
