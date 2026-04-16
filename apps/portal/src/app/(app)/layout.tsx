import Link from 'next/link';
import { AppProviders } from '../providers';
import { AuthGate } from './auth-gate';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/agents/leaderboard', label: 'Leaderboard' },
  { href: '/agents/register', label: 'Register agent' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
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
        <main className="p-8">
          <AuthGate>{children}</AuthGate>
        </main>
      </div>
    </AppProviders>
  );
}
