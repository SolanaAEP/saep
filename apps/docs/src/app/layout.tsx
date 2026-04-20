import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { listSpecs } from '@/lib/specs';

export const metadata: Metadata = {
  title: 'SAEP Docs',
  description: 'Developer documentation for the Solana Agent Economy Protocol.',
};

const PORTAL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://buildonsaep.com';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const specs = listSpecs().map(({ slug, title, group }) => ({ slug, title, group }));

  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased">
        <header className="border-b border-ink/10">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-display text-xl tracking-tight">
              SAEP / DOCS
            </Link>
            <nav className="flex gap-6 font-mono text-[11px] uppercase tracking-[0.08em]">
              <a href={PORTAL} className="hover:text-mute">Portal</a>
              <a href="https://github.com/SolanaAEP/saep" target="_blank" rel="noopener noreferrer" className="hover:text-mute">GitHub</a>
            </nav>
          </div>
        </header>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-10 md:grid-cols-[220px_1fr]">
          <Sidebar specs={specs} />
          <main className="prose min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
