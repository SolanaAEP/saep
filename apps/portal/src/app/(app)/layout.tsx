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
      <div className="relative min-h-screen p-[clamp(20px,2.5vw,36px)]">
        {/* Protocol frame — outer borders */}
        <div
          aria-hidden="true"
          className="fixed pointer-events-none border z-20"
          style={{ inset: 'clamp(6px,0.8vw,14px)', borderColor: '#ccc' }}
        />
        <div
          aria-hidden="true"
          className="fixed pointer-events-none border z-20"
          style={{ inset: 'clamp(14px,1.8vw,28px)', borderColor: '#ccc' }}
        />

        {/* Corner brackets */}
        <div aria-hidden="true" className="fixed left-[clamp(14px,1.5vw,22px)] top-[clamp(14px,1.5vw,22px)] h-3 w-3 border-t border-l border-ink/55 z-20" />
        <div aria-hidden="true" className="fixed right-[clamp(14px,1.5vw,22px)] top-[clamp(14px,1.5vw,22px)] h-3 w-3 border-t border-r border-ink/55 z-20" />
        <div aria-hidden="true" className="fixed left-[clamp(14px,1.5vw,22px)] bottom-[clamp(14px,1.5vw,22px)] h-3 w-3 border-b border-l border-ink/55 z-20" />
        <div aria-hidden="true" className="fixed right-[clamp(14px,1.5vw,22px)] bottom-[clamp(14px,1.5vw,22px)] h-3 w-3 border-b border-r border-ink/55 z-20" />

        {/* Top-left system label */}
        <div
          aria-hidden="true"
          className="fixed left-[calc(clamp(20px,2.5vw,36px)+16px)] top-[calc(clamp(20px,2.5vw,36px)+8px)] font-mono text-[10px] text-ink/60 uppercase tracking-[0.08em] z-20 pointer-events-none"
        >
          SAEP PROTOCOL // OPERATOR CONSOLE
        </div>

        {/* Bottom-right status + barcode */}
        <div
          aria-hidden="true"
          className="fixed right-[calc(clamp(20px,2.5vw,36px)+16px)] bottom-[calc(clamp(20px,2.5vw,36px)+8px)] flex items-end gap-4 z-20 pointer-events-none"
        >
          <div className="font-mono text-[10px] text-ink/60 uppercase tracking-[0.08em] text-right leading-relaxed">
            <div>CLUSTER: {process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet'}</div>
            <div className="text-lime">SYS[OK]</div>
          </div>
          <img src="/barcode-ink.svg" alt="" aria-hidden="true" className="h-10 w-auto opacity-40" />
        </div>

        {/* App grid */}
        <div className="grid grid-cols-[220px_1fr] min-h-[calc(100vh-clamp(40px,5vw,72px))]">
          <aside className="border-r border-ink/10 p-5 flex flex-col gap-5">
            <Link href="/" className="flex items-center gap-2 font-display text-lg tracking-tight">
              <img src="/logomark-bw.svg" alt="" aria-hidden="true" className="h-5 w-5" />
              SAEP
            </Link>

            <nav className="flex flex-col gap-0.5">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center gap-2 px-2 py-1.5 hover:bg-ink/5 transition-colors"
                >
                  <span className="font-mono text-[10px] text-mute">{item.tag}</span>
                  <span className="text-sm">{item.label}</span>
                </Link>
              ))}
            </nav>
          </aside>

          <main className="p-8 overflow-auto">
            <AuthGate>{children}</AuthGate>
          </main>
        </div>
      </div>
    </AppProviders>
  );
}
