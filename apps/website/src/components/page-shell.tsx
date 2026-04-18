import Link from 'next/link';
import { secondaryNav } from './nav-items';
import { MobileNav } from './mobile-nav';

type Crumb = { label: string; href?: string };

export function PageShell({
  eyebrow,
  crumbs,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  crumbs?: Crumb[];
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-paper text-ink flex flex-col">
      <header className="sticky top-0 z-40 bg-paper/90 backdrop-blur border-b border-ink/10">
        <div className="px-[clamp(20px,4vw,64px)] py-5 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-[22px] tracking-[-0.02em] leading-none"
          >
            <img src="/logomark-bw.svg" alt="" aria-hidden="true" className="h-6 w-6" />
            SAEP
          </Link>
          <nav className="hidden md:flex items-center gap-6" aria-label="Primary">
            {secondaryNav.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className="font-mono uppercase text-[11px] tracking-[0.08em] text-ink hover:text-[#06f512] transition-colors"
              >
                {s.label}
              </a>
            ))}
          </nav>
          <MobileNav />
        </div>
      </header>

      <main className="flex-1 px-[clamp(20px,5vw,80px)] py-[clamp(40px,6vw,80px)]">
        <div>
          <div className="flex items-center gap-3 font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            <span>{eyebrow}</span>
            {crumbs?.map((c, i) => (
              <span key={i} className="flex items-center gap-3">
                <span>/</span>
                {c.href ? (
                  <a href={c.href} className="hover:text-ink">
                    {c.label}
                  </a>
                ) : (
                  <span className="text-ink">{c.label}</span>
                )}
              </span>
            ))}
          </div>
          <h1 className="mt-6 font-display text-[clamp(36px,5.5vw,72px)] leading-[0.92] tracking-[-0.01em]">
            {title}
          </h1>
          {lede ? (
            <p className="mt-5 max-w-3xl text-[17px] leading-relaxed text-ink/80">{lede}</p>
          ) : null}
          <div className="mt-14">{children}</div>
        </div>
      </main>

      <footer className="mt-24 border-t border-ink/15 px-[clamp(20px,5vw,80px)] py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/logomark-bw.svg" alt="" aria-hidden="true" className="h-5 w-5" />
          <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-mute">
            © 2026 SAEP Protocol
          </span>
        </div>
        <div className="flex gap-6 font-mono uppercase text-[10px] tracking-[0.08em] text-mute">
          <a href="/docs" className="hover:text-ink">Docs</a>
          <a href="/specs" className="hover:text-ink">Specs</a>
          <a href="/security" className="hover:text-ink">Security</a>
          <a href="/governance" className="hover:text-ink">Governance</a>
        </div>
      </footer>
    </div>
  );
}
