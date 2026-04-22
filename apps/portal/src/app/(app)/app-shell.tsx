'use client';

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const content = isPublicRoute(pathname) ? children : <AuthGate>{children}</AuthGate>;

  return (
    <AppProviders>
      <div className="min-h-screen bg-paper text-ink">
        <div className="grid min-h-screen grid-cols-[260px_1fr]">
          <aside className="bg-paper-2 px-6 py-7">
            <Link
              href="/"
              className="flex items-center gap-2 font-display text-[22px] tracking-[-0.02em] leading-none"
            >
              <img src="/logomark-bw.svg" alt="" aria-hidden="true" className="h-6 w-6" />
              SAEP
            </Link>
            <nav className="mt-10 flex flex-col gap-1.5 text-[13px]" aria-label="App">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-xl px-3 py-2 font-mono uppercase tracking-[0.08em] transition-colors ${
                    pathname === item.href || pathname?.startsWith(`${item.href}/`)
                      ? 'bg-paper text-ink'
                      : 'text-ink/62 hover:bg-paper hover:text-ink'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="px-8 py-8 md:px-10 md:py-10">{content}</main>
        </div>
      </div>
    </AppProviders>
  );
}
