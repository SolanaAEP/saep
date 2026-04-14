import { TickerStack, TickerMarquee } from './ticker-stack';
import { HeroComposition } from './hero-composition';
import { LeaderNav } from './leader-nav';
import { WordmarkSpine } from './wordmark-spine';
import { MobileNav } from './mobile-nav';
import { Chip } from './chip';
import { secondaryNav } from './nav-items';

const BUILD_SHA = (process.env.NEXT_PUBLIC_BUILD_SHA ?? 'devnet-local').slice(0, 7);
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '2026-04-14 00:00 UTC';

export function Hero() {
  return (
    <section className="relative w-full bg-paper text-ink overflow-hidden" style={{ minHeight: '100svh' }}>
      <div className="absolute inset-0 px-[clamp(20px,4vw,64px)] py-[clamp(20px,3vw,40px)] pointer-events-none z-30 flex flex-col justify-between">
        <div className="flex justify-between items-start">
          <div className="font-mono text-[10px] leading-[1.6] text-mute uppercase tracking-[0.08em]">
            <div>2026 · 04 · 14</div>
            <div>VERSION&nbsp;&nbsp;01</div>
            <div>STATUS&nbsp;&nbsp;&nbsp;DEVNET</div>
          </div>
          <div className="hidden md:block font-mono text-[10px] leading-[1.6] text-mute uppercase tracking-[0.08em] text-right">
            <div>BUILD&nbsp;&nbsp;&nbsp;{BUILD_SHA}</div>
            <div>{BUILD_TIME}</div>
          </div>
        </div>

        <div className="flex justify-between items-end gap-6">
          <div className="flex flex-wrap gap-2 max-w-[60%]">
            <Chip>Agent Layer Active</Chip>
            <Chip>Real-time State</Chip>
            <Chip>Execution Path</Chip>
            <Chip>Verified</Chip>
          </div>
          <div className="hidden md:block font-mono text-[10px] leading-[1.6] text-mute uppercase tracking-[0.08em] text-right">
            <div>M1 · ALPHA</div>
            <div>LIVE SETTLEMENT · 00</div>
          </div>
        </div>
      </div>

      <header className="absolute top-0 right-0 z-40 px-[clamp(20px,4vw,64px)] py-[clamp(20px,3vw,40px)] flex items-center gap-6">
        <nav className="hidden md:flex items-center gap-5" aria-label="Secondary">
          {secondaryNav.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="font-mono uppercase text-[11px] tracking-[0.08em] text-ink hover:text-lime transition-colors"
            >
              {s.label}
            </a>
          ))}
        </nav>
        <MobileNav />
      </header>

      <div className="relative z-10 grid h-full w-full" style={{ minHeight: '100svh' }}>
        <div className="hidden md:grid absolute inset-0" style={{ gridTemplateColumns: '20% 1fr 22% 6%' }}>
          <div className="pl-[clamp(20px,4vw,64px)] pt-24 pb-24">
            <TickerStack />
          </div>
          <div className="flex items-center justify-center p-8">
            <div className="w-full max-w-[520px] aspect-[4/5]">
              <HeroComposition />
            </div>
          </div>
          <div className="pr-4 pt-28 pb-28">
            <LeaderNav />
          </div>
          <div className="hidden lg:block border-l border-ink/15 py-24">
            <WordmarkSpine />
          </div>
        </div>

        <div className="md:hidden flex flex-col gap-6 pt-24 pb-28 px-5">
          <TickerMarquee />
          <div className="w-full max-h-[60vh]">
            <HeroComposition />
          </div>
          <div>
            <h1 className="font-display text-[40px] leading-[0.95] tracking-[-0.01em] text-ink">
              Solana Agent Economy Protocol.
            </h1>
            <p className="mt-4 font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Real-time state · Execution path · Verified
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
