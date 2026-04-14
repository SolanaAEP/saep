const PORTAL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://buildonsaep.com';
const DOCS = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://buildonsaep.com/docs';

export function Nav() {
  return (
    <header className="border-b border-ink">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="/" className="font-display text-xl tracking-tight">
          SAEP / ANALYTICS
        </a>
        <nav className="flex gap-6 font-mono text-[11px] uppercase tracking-[0.08em]">
          <a href={PORTAL} className="hover:text-mute">
            Portal
          </a>
          <a href={DOCS} className="hover:text-mute">
            Docs
          </a>
        </nav>
      </div>
    </header>
  );
}
