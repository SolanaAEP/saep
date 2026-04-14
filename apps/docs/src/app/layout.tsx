import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';

export const metadata: Metadata = {
  title: 'SAEP Docs',
  description: 'Developer documentation for the Solana Agent Economy Protocol.',
};

const PORTAL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://buildonsaep.com';
const ANALYTICS =
  process.env.NEXT_PUBLIC_ANALYTICS_URL ?? 'https://buildonsaep.com/analytics';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased">
        <header className="border-b border-ink">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <a href="/" className="font-display text-xl tracking-tight">
              SAEP / DOCS
            </a>
            <nav className="flex gap-6 font-mono text-[11px] uppercase tracking-[0.08em]">
              <a href={PORTAL} className="hover:text-mute">Portal</a>
              <a href={ANALYTICS} className="hover:text-mute">Analytics</a>
            </nav>
          </div>
        </header>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-10 md:grid-cols-[220px_1fr]">
          <Sidebar />
          <main className="prose min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
