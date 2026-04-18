import Link from 'next/link';
import { AppProviders } from '../providers';
import { AuthGate } from './auth-gate';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', tag: '00' },
  { href: '/marketplace', label: 'Marketplace', tag: '01' },
  { href: '/treasury', label: 'Treasury', tag: '02' },
  { href: '/agents/leaderboard', label: 'Leaderboard', tag: '03' },
  { href: '/agents/register', label: 'Register agent', tag: '04' },
  { href: '/governance', label: 'Governance', tag: '05' },
  { href: '/retro/check', label: 'Retro eligibility', tag: '06' },
  { href: '/analytics', label: 'Analytics', tag: '07' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProviders>
      <div className="min-h-screen grid grid-cols-[240px_1fr]">
        <aside className="border-r border-ink/10 p-6 flex flex-col gap-6">
          <Link href="/" className="font-display text-lg tracking-tight">
            SAEP
          </Link>

          <nav className="flex flex-col gap-0.5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink/5 transition-colors"
              >
                <span className="font-mono text-[10px] text-mute">{item.tag}</span>
                <span className="text-sm">{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-2">
            <div className="h-px bg-ink/10" />
            <div className="font-mono text-[10px] text-mute leading-relaxed">
              <div>SAEP PROTOCOL</div>
              <div>CLUSTER: {process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet'}</div>
              <div className="text-lime">SYS[OK]</div>
            </div>
          </div>
        </aside>

        <main className="p-8">
          <AuthGate>{children}</AuthGate>
        </main>
      </div>
    </AppProviders>
  );
}
