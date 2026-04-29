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
  { href: '/agents/qvac', label: 'QVAC agent' },
  { href: '/governance', label: 'Governance' },
  { href: '/retro/check', label: 'Retro eligibility' },
  { href: '/analytics', label: 'Analytics' },
];

function isPublicRoute(pathname: string | null): boolean {
  return (
    pathname === '/analytics' ||
    pathname?.startsWith('/analytics/') === true ||
    pathname === '/staking' ||
    pathname?.startsWith('/staking/') === true ||
    pathname === '/templates' ||
    pathname?.startsWith('/templates/') === true ||
    pathname === '/agents/qvac' ||
    pathname?.startsWith('/agents/qvac/') === true
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const content = isPublicRoute(pathname) ? children : <AuthGate>{children}</AuthGate>;

  return (
    <AppProviders>
      <div className="min-h-screen bg-paper text-ink">
        <div className="grid min-h-screen md:grid-cols-[300px_1fr]">
          <aside className="px-10 py-14 md:px-11 md:py-14">
            <Link
              href="/"
              className="flex items-center gap-4 font-display text-[46px] leading-none tracking-[-0.04em] text-ink"
            >
              <img src="/logomark-bw.svg" alt="" aria-hidden="true" className="h-12 w-12 shrink-0" />
              SAEP
            </Link>
            <nav className="mt-20 flex flex-col gap-6" aria-label="App">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block w-full max-w-[220px] font-mono text-[11px] leading-[1.35] uppercase tracking-[0.18em] transition-colors ${
                    pathname === item.href || pathname?.startsWith(`${item.href}/`)
                      ? 'text-ink'
                      : 'text-ink/58 hover:text-ink/78'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="px-8 py-10 md:px-12 md:py-12">{content}</main>
        </div>
      </div>
    </AppProviders>
  );
}
