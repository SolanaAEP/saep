'use client';

import { useEffect, useRef, useState } from 'react';
import { navItems, secondaryNav } from './nav-items';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onCancel = (e: Event) => {
      e.preventDefault();
      setOpen(false);
    };
    d.addEventListener('close', onClose);
    d.addEventListener('cancel', onCancel);
    return () => {
      d.removeEventListener('close', onClose);
      d.removeEventListener('cancel', onCancel);
    };
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(true)}
        className="md:hidden inline-flex items-center justify-center w-11 h-11 text-ink"
      >
        <span className="sr-only">Menu</span>
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
          <rect y="0" width="22" height="2" fill="currentColor" />
          <rect y="6" width="22" height="2" fill="currentColor" />
          <rect y="12" width="22" height="2" fill="currentColor" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        id="mobile-nav"
        className="mobile-nav"
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
      >
        <div className="flex flex-col h-full p-6">
          <div className="flex items-center justify-between">
            <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
              Menu
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-11 h-11 inline-flex items-center justify-center text-ink"
            >
              <span className="sr-only">Close menu</span>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M 2 2 L 18 18 M 18 2 L 2 18" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </div>
          <ul className="mt-10 flex flex-col gap-5">
            {navItems.map((item, i) => (
              <li key={item.slug}>
                <a
                  href={`#${item.slug}`}
                  onClick={() => setOpen(false)}
                  className="font-mono uppercase text-sm tracking-[0.08em] text-ink"
                >
                  <span className="text-mute mr-3">0{i + 1}</span>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <ul className="mt-auto flex flex-col gap-3 border-t border-ink/20 pt-6">
            {secondaryNav.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  className="font-mono uppercase text-xs tracking-[0.08em] text-ink"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
