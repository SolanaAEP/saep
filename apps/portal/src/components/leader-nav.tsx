'use client';

import { navItems } from './nav-items';

export function LeaderNav() {
  return (
    <nav aria-label="Protocol flow" className="h-full w-full">
      <ul className="flex flex-col justify-between h-full py-6">
        {navItems.map((item, i) => (
          <li key={item.slug} className="group relative">
            <a
              href={`#${item.slug}`}
              className="flex items-center justify-end gap-3 font-mono uppercase text-[11px] tracking-[0.08em] text-ink hover:text-[#a8db1a] transition-colors"
            >
              <svg
                aria-hidden="true"
                width="60"
                height="12"
                viewBox="0 0 60 12"
                className="opacity-60 group-hover:opacity-100"
              >
                <path
                  d="M 0 6 H 60"
                  stroke="currentColor"
                  strokeWidth="1"
                  fill="none"
                />
                <circle
                  cx="2"
                  cy="6"
                  r="2"
                  fill="var(--lime)"
                  className="opacity-0 group-hover:opacity-100"
                />
              </svg>
              <span>
                <span className="text-mute mr-2">0{i + 1}</span>
                {item.label}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
