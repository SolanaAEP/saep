'use client';

import { useState, useRef, useLayoutEffect } from 'react';
import { TickerStack, TickerMarquee } from './ticker-stack';
import { LeaderNav } from './leader-nav';
import { WordmarkSpine } from './wordmark-spine';
import { MobileNav } from './mobile-nav';
import { SlicedHeroImage } from './sliced-hero-image';
import { secondaryNav } from './nav-items';

const BUILD_SHA = (process.env.NEXT_PUBLIC_BUILD_SHA ?? 'devnet-local').slice(0, 7);
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '2026-04-14 00:00 UTC';

export function Hero() {
  const [navHovered, setNavHovered] = useState(false);
  const [itemCenters, setItemCenters] = useState<number[]>([]);
  const imageBoxRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    function measure() {
      const box = imageBoxRef.current;
      const nav = navRef.current;
      if (!box || !nav) return;
      const boxRect = box.getBoundingClientRect();
      if (boxRect.height === 0) return;
      const items = Array.from(nav.querySelectorAll('li'));
      const centers = items.map((li) => {
        const r = li.getBoundingClientRect();
        return ((r.top + r.height / 2 - boxRect.top) / boxRect.height) * 100;
      });
      setItemCenters(centers);
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (imageBoxRef.current) ro.observe(imageBoxRef.current);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, []);
  return (
    <section className="relative w-full bg-paper text-ink overflow-hidden" style={{ minHeight: '100svh' }}>
      <div
        aria-hidden="true"
        className="absolute pointer-events-none border z-20"
        style={{ inset: 'clamp(6px,0.8vw,14px)', borderColor: '#ccc' }}
      />
      <div
        aria-hidden="true"
        className="absolute pointer-events-none border z-20"
        style={{ inset: 'clamp(14px,1.8vw,28px)', borderColor: '#ccc' }}
      />

      <div className="absolute inset-0 px-[clamp(20px,4vw,64px)] py-[clamp(20px,3vw,40px)] pointer-events-none z-30">
        <div className="absolute left-[clamp(14px,1.5vw,22px)] top-[clamp(14px,1.5vw,22px)] h-3 w-3 border-t border-l border-ink/55" />
        <div className="absolute right-[clamp(14px,1.5vw,22px)] top-[clamp(14px,1.5vw,22px)] h-3 w-3 border-t border-r border-ink/55" />
        <div className="absolute left-[clamp(14px,1.5vw,22px)] bottom-[clamp(14px,1.5vw,22px)] h-3 w-3 border-b border-l border-ink/55" />
        <div className="absolute right-[clamp(14px,1.5vw,22px)] bottom-[clamp(14px,1.5vw,22px)] h-3 w-3 border-b border-r border-ink/55" />

        <div className="absolute left-[calc(clamp(20px,4vw,64px)+28px)] top-[calc(clamp(20px,3vw,40px)+28px)] font-mono text-[10px] leading-[1.6] text-ink/80 uppercase tracking-[0.08em] flex gap-6">
          <div>
            <div>SYS.OP.01</div>
            <div>SEQ.994.2</div>
          </div>
          <div>
            <div>INTENT -&gt; AGENT -&gt;</div>
            <div>STRATEGY -&gt; EXECUTE -&gt;</div>
            <div>LIVE</div>
          </div>
        </div>

        <div
          className="absolute right-[calc(clamp(20px,4vw,64px)+18px)] top-[calc(clamp(20px,3vw,40px)+56px)] font-mono text-[10px] text-ink/60 tracking-[0.15em]"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          1938210948123 . A . 18392103 4812 . B
        </div>

        <div className="absolute left-[calc(clamp(20px,4vw,64px)+28px)] bottom-[calc(clamp(20px,3vw,40px)+28px)] font-mono text-[10px] leading-[1.6] text-ink/80 uppercase tracking-[0.08em]">
          <div>AGENT LAYER ACTIVE</div>
          <div>REAL-TIME STATE</div>
          <div>EXECUTION PATH VERIFIED</div>
        </div>

        <div className="absolute right-[calc(clamp(20px,4vw,64px)+28px)] bottom-[calc(clamp(20px,3vw,40px)+28px)] flex flex-col items-end gap-2 pointer-events-auto">
          <div className="h-4 w-16 bg-lime" />
          <a
            href="https://buildonsaep.com"
            aria-label="Scannable Code128 barcode for buildonsaep.com"
            className="block"
          >
            <img
              src="/barcode-ink.svg"
              alt=""
              aria-hidden="true"
              className="h-16 w-auto"
            />
          </a>
          <div className="font-mono text-[10px] text-ink/70 tracking-[0.1em]">0101001 / 010001</div>
          <div className="font-mono text-[10px] leading-[1.6] text-ink/80 uppercase tracking-[0.08em] text-right">
            <div>SOLANA AGENT ECONOMY PROTOCOL</div>
            <div>V.2.0.0 // PROTOCOL LIVE</div>
            <div>ALL SYSTEMS NOMINAL</div>
          </div>
          <div className="hidden font-mono text-[10px] text-mute">{BUILD_SHA} · {BUILD_TIME}</div>
        </div>
      </div>

      <header className="absolute top-0 right-0 z-40 px-[clamp(20px,4vw,64px)] py-[clamp(20px,3vw,40px)] flex items-center gap-6">
        <nav className="hidden md:flex items-center gap-5" aria-label="Secondary">
          {secondaryNav.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="font-mono uppercase text-[11px] tracking-[0.08em] text-ink hover:text-[#06f512] transition-colors"
            >
              {s.label}
            </a>
          ))}
        </nav>
        <MobileNav />
      </header>

      <div className="relative z-10 hidden md:block" style={{ minHeight: '100svh' }}>
        <div className="absolute left-0 top-0 bottom-0 w-[20%] pl-[clamp(20px,4vw,64px)] pt-40 pb-40 border-r" style={{ borderColor: '#ccc' }}>
          <TickerStack />
        </div>
        <div className="absolute right-0 top-0 bottom-0 hidden lg:block w-[6%] border-l py-24" style={{ borderColor: '#ccc' }}>
          <WordmarkSpine />
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
          <div
            ref={imageBoxRef}
            className="relative"
          >
            <SlicedHeroImage navHovered={navHovered} itemCenters={itemCenters} />
            <div
              className="absolute right-32 top-1/2 -translate-y-1/2 h-[min(70%,520px)] w-[200px] pointer-events-auto"
              onMouseEnter={() => setNavHovered(true)}
              onMouseLeave={() => setNavHovered(false)}
            >
              <LeaderNav ref={navRef} />
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 md:hidden flex flex-col gap-6 pt-24 pb-28 px-5">
        <TickerMarquee />
        <div className="relative w-full max-h-[60vh]">
          <img
            src="/hero-bg.jpg"
            alt=""
            aria-hidden="true"
            className="w-full object-cover"
            style={{
              maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 40%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 40%, transparent 100%)',
            }}
          />
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
    </section>
  );
}
