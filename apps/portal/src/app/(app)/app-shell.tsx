'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppProviders } from '../providers';
import { AuthGate } from './auth-gate';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/treasury', label: 'Treasury' },
  { href: '/agents/leaderboard', label: 'Leaderboard' },
  { href: '/agents/register', label: 'Register agent' },
  { href: '/governance', label: 'Governance' },
  { href: '/retro/check', label: 'Retro eligibility' },
  { href: '/analytics', label: 'Analytics' },
];

const PUBLIC_EXACT_ROUTES = new Set([
  '/agents/leaderboard',
  '/analytics',
  '/cross-chain',
  '/developers',
  '/integrations',
  '/marketplace',
  '/protocol',
  '/tasks',
]);

const PUBLIC_PREFIX_ROUTES = [
  '/analytics/',
  '/cross-chain/',
  '/developers/',
  '/integrations/',
  '/marketplace/',
  '/protocol/',
  '/tasks/',
];

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (PUBLIC_EXACT_ROUTES.has(pathname)) return true;
  if (PUBLIC_PREFIX_ROUTES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (pathname.startsWith('/agents/') && !pathname.startsWith('/agents/register')) return true;
  return false;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const content = isPublicRoute(pathname) ? children : <AuthGate>{children}</AuthGate>;

  return (
    <AppProviders>
      <div className="min-h-screen grid grid-cols-[240px_1fr]">
        <aside className="border-r border-ink/10 p-6 flex flex-col gap-6">
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
    </AppProviders>
  );
}
