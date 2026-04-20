'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

type SpecItem = { slug: string; title: string; group: string };

const GROUPS: { key: string; label: string }[] = [
  { key: 'protocol', label: 'Protocol' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'security', label: 'Security' },
  { key: 'ops', label: 'Operations' },
];

export function Sidebar({ specs }: { specs: SpecItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <aside className="font-mono text-[12px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between border border-ink/10 px-3 py-2 md:hidden"
      >
        <span className="text-[10px] uppercase tracking-widest text-mute">Navigation</span>
        <span className="text-mute">{open ? '−' : '+'}</span>
      </button>
      <nav className={`${open ? 'block' : 'hidden'} md:block mt-2 md:mt-0`}>
        {GROUPS.map((g) => {
          const items = specs.filter((s) => s.group === g.key);
          if (items.length === 0) return null;
          return <Section key={g.key} title={g.label} items={items} pathname={pathname} />;
        })}
        <div className="mt-6 border-t border-ink/10 pt-4">
          <Link href="/" className={`block hover:text-mute ${pathname === '/' ? 'text-lime' : ''}`}>
            ← All specs
          </Link>
        </div>
      </nav>
    </aside>
  );
}

function Section({
  title,
  items,
  pathname,
}: {
  title: string;
  items: SpecItem[];
  pathname: string;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-mute">
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((i) => {
          const href = `/specs/${i.slug}/`;
          const active = pathname === href || pathname === `/specs/${i.slug}`;
          return (
            <li key={i.slug}>
              <Link
                href={href}
                className={`block py-0.5 ${active ? 'text-lime' : 'hover:text-mute'}`}
              >
                {i.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
