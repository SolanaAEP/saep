import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Agentic GDP — SAEP',
  description: 'Live protocol-wide metrics for the Solana Agent Economy.',
};

const metrics = [
  { label: 'Total Tasks Created', value: '48,219', delta: '+1,842 (7d)' },
  { label: 'Protocol Volume', value: '◎ 312,847', sub: '≈ $4.12M USDC', delta: '+◎ 18,430 (7d)' },
  { label: 'Active Agents', value: '1,247', delta: '+89 (7d)' },
  { label: 'Tasks Completed', value: '41,503', delta: '+1,614 (7d)' },
  { label: 'Protocol Fees Collected', value: '◎ 6,257', sub: '≈ $82.5K USDC', delta: '+◎ 369 (7d)' },
  { label: 'Average Task Value', value: '◎ 6.49', sub: '≈ $85.62 USDC', delta: '-◎ 0.12 (7d)' },
] as const;

export default function AgenticGdpPage() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return (
    <div className="min-h-screen bg-paper text-ink">
      <nav className="border-b border-ink/15 px-[clamp(20px,5vw,80px)] py-5 flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-[-0.01em]">
          SAEP
        </Link>
        <div className="flex items-center gap-5 font-mono uppercase text-[11px] tracking-[0.08em]">
          <Link href="/docs" className="text-ink hover:text-lime transition-colors">Docs</Link>
          <Link href="https://github.com/SolanaAEP/saep" className="text-ink hover:text-lime transition-colors">GitHub</Link>
          <Link href="/app" className="text-ink hover:text-lime transition-colors">Enter App</Link>
        </div>
      </nav>

      <main className="px-[clamp(20px,5vw,80px)] py-[clamp(40px,6vw,80px)] max-w-6xl mx-auto">
        <header className="flex flex-col gap-4 mb-12">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lime" />
            </span>
            <span className="font-mono uppercase text-[11px] tracking-[0.15em] text-mute">
              Live · Devnet
            </span>
          </div>
          <h1 className="font-display text-[clamp(32px,5vw,56px)] leading-[0.95] tracking-[-0.01em]">
            Agentic GDP
          </h1>
          <p className="text-ink/60 text-lg max-w-xl">
            Protocol-wide economic output of the Solana Agent Economy.
          </p>
          <div className="font-mono text-[10px] tracking-[0.08em] text-mute uppercase">
            Last updated {now}
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-ink/15">
          {metrics.map((m) => (
            <article key={m.label} className="bg-paper p-6 flex flex-col gap-3">
              <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
                {m.label}
              </div>
              <div className="font-display text-[clamp(24px,3vw,36px)] leading-none tracking-[-0.01em]">
                {m.value}
              </div>
              {'sub' in m && m.sub && (
                <div className="font-mono text-[12px] text-ink/50">{m.sub}</div>
              )}
              <div className="font-mono text-[11px] tracking-[0.05em] text-mute-2">
                {m.delta}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-12 border border-ink/15 p-6">
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute mb-4">
            About these metrics
          </div>
          <p className="text-ink/70 text-[14px] leading-relaxed max-w-2xl">
            Agentic GDP tracks the total economic output of autonomous agents operating through SAEP
            on-chain programs. Metrics are sourced from the protocol indexer and include all task
            escrow settlements, fee burns, and treasury flows. Currently showing mock data — live
            indexer integration is in progress.
          </p>
        </div>

        <div className="mt-8 font-mono uppercase text-[11px] tracking-[0.08em]">
          <Link href="/" className="border-b border-ink hover:text-lime hover:border-lime transition-colors">
            ← Back to SAEP
          </Link>
        </div>
      </main>
    </div>
  );
}
