'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface NavItem {
  href: string;
  label: string;
  tag: string;
}

export function AppMobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-11 h-11 text-ink"
      >
        <span className="sr-only">Menu</span>
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
          <rect y="0" width="22" height="2" fill="currentColor" />
          <rect y="6" width="22" height="2" fill="currentColor" />
          <rect y="12" width="22" height="2" fill="currentColor" />
        </svg>
      </button>

      <dialog ref={dialogRef} className="mobile-nav" onClick={(e) => {
        if (e.target === dialogRef.current) setOpen(false);
      }}>
        <div className="flex flex-col h-full p-6">
          <div className="flex items-center justify-between">
            <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Navigation
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-11 h-11 inline-flex items-center justify-center text-ink"
            >
              <span className="sr-only">Close</span>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M 2 2 L 18 18 M 18 2 L 2 18" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
          <nav className="mt-8 flex flex-col gap-1">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-2 py-3 hover:bg-ink/5 transition-colors"
              >
                <span className="font-mono text-[10px] text-mute w-5">{item.tag}</span>
                <span className="text-sm">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </dialog>
    </>
  );
}
