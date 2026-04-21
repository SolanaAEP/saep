'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppProviders } from '../providers';
import { AuthGate } from './auth-gate';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/treasury', label: 'Treasury' },
  { href: '/staking', label: 'Staking' },
  { href: '/agents/leaderboard', label: 'Leaderboard' },
  { href: '/agents/register', label: 'Register agent' },
  { href: '/governance', label: 'Governance' },
  { href: '/retro/check', label: 'Retro eligibility' },
  { href: '/analytics', label: 'Analytics' },
];

function isPublicRoute(pathname: string | null): boolean {
  return (
    pathname === '/analytics' ||
    pathname?.startsWith('/analytics/') === true ||
    pathname === '/staking' ||
    pathname?.startsWith('/staking/') === true
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function useShellChromeOpacity(): number {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const next = clamp(1 - window.scrollY / 240, 0, 1);
      setOpacity((current) => (Math.abs(current - next) < 0.01 ? current : next));
    };

    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return opacity;
}

function ShellChrome({ opacity }: { opacity: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-20 hidden md:block transition-opacity duration-200 ease-out"
      style={{ opacity }}
    >
      <div className="absolute inset-[clamp(6px,0.8vw,14px)] border border-ink/12" />
      <div className="absolute inset-[clamp(14px,1.8vw,28px)] border border-ink/8" />

      <div className="absolute left-[clamp(14px,1.5vw,22px)] top-[clamp(14px,1.5vw,22px)] h-3 w-3 border-l border-t border-ink/50" />
      <div className="absolute right-[clamp(14px,1.5vw,22px)] top-[clamp(14px,1.5vw,22px)] h-3 w-3 border-r border-t border-ink/50" />
      <div className="absolute bottom-[clamp(14px,1.5vw,22px)] left-[clamp(14px,1.5vw,22px)] h-3 w-3 border-b border-l border-ink/50" />
      <div className="absolute bottom-[clamp(14px,1.5vw,22px)] right-[clamp(14px,1.5vw,22px)] h-3 w-3 border-b border-r border-ink/50" />

      <div className="absolute left-[calc(240px+clamp(20px,2.5vw,36px)+24px)] top-[calc(clamp(20px,2.5vw,36px)+8px)] font-mono text-[10px] uppercase tracking-[0.08em] text-ink/60">
        SAEP APP // OPERATOR SURFACE
      </div>

      <div className="absolute right-[calc(clamp(20px,2.5vw,36px)+18px)] top-[calc(clamp(20px,2.5vw,36px)+24px)] font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45 [writing-mode:vertical-rl] [transform:rotate(180deg)]">
        LIVE TASK MARKET // DEVNET
      </div>

      <div className="absolute left-[calc(240px+clamp(20px,2.5vw,36px)+24px)] bottom-[calc(clamp(20px,2.5vw,36px)+8px)] font-mono text-[10px] uppercase tracking-[0.08em] text-ink/45">
        <div>FRAME RESPONDS TO SCROLL</div>
        <div>DECORATIVE CHROME ONLY</div>
      </div>

      <div className="absolute right-[calc(clamp(20px,2.5vw,36px)+18px)] bottom-[calc(clamp(20px,2.5vw,36px)+12px)] flex items-end gap-4">
        <div
          className="h-16 w-16 border border-ink/20 bg-paper/70"
          style={{
            backgroundImage: [
              'linear-gradient(90deg, transparent 0 20%, var(--ink) 20% 35%, transparent 35% 50%, var(--ink) 50% 65%, transparent 65% 100%)',
              'linear-gradient(transparent 0 18%, var(--ink) 18% 32%, transparent 32% 48%, var(--ink) 48% 62%, transparent 62% 100%)',
              'linear-gradient(90deg, transparent 0 68%, var(--ink) 68% 84%, transparent 84% 100%)',
              'linear-gradient(transparent 0 68%, var(--ink) 68% 84%, transparent 84% 100%)',
            ].join(','),
          }}
        />
        <div className="flex flex-col items-end gap-2">
          <div
            className="h-10 w-28 opacity-45"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to right, var(--ink) 0 2px, transparent 2px 5px, var(--ink) 5px 7px, transparent 7px 9px, var(--ink) 9px 14px, transparent 14px 16px)',
            }}
          />
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink/55">
            scroll to dim chrome
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const chromeOpacity = useShellChromeOpacity();
  const content = isPublicRoute(pathname) ? children : <AuthGate>{children}</AuthGate>;

  return (
    <AppProviders>
      <div className="relative min-h-screen overflow-x-hidden bg-paper text-ink">
        <ShellChrome opacity={chromeOpacity} />

        <div className="relative z-10 grid min-h-screen grid-cols-[240px_1fr]">
          <aside className="border-r border-ink/10 bg-paper/85 p-6 flex flex-col gap-6 backdrop-blur-[1px]">
            <Link href="/" className="font-[var(--font-archivo)] text-lg tracking-tight">
              SAEP
            </Link>
            <nav className="flex flex-col gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-2 py-1.5 rounded hover:bg-ink/5"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto text-xs text-ink/60">
              Cluster: {process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet'}
            </div>
          </aside>
          <main className="p-8">{content}</main>
        </div>
      </div>
    </AppProviders>
  );
}
