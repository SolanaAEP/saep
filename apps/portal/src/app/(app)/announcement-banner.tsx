'use client';

import { useEffect, useState } from 'react';

interface AnnouncementBannerProps {
  text: string;
  href?: string;
  id: string;
}

export function AnnouncementBanner({ text, href, id }: AnnouncementBannerProps) {
  const storageKey = `announcement-dismissed:${id}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) setVisible(true);
  }, [storageKey]);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(storageKey, '1');
    setVisible(false);
  }

  const content = (
    <span className="flex items-center gap-2 min-w-0">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-lime" />
      </span>
      <span className="truncate">{text}</span>
    </span>
  );

  return (
    <div className="flex items-center justify-between gap-4 rounded border border-lime/20 bg-lime/10 px-4 py-2 font-mono text-[11px] text-ink/80">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center hover:underline">
          {content}
        </a>
      ) : (
        content
      )}
      <button onClick={dismiss} className="shrink-0 text-ink/40 hover:text-ink transition-colors" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
