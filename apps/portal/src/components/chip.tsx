import { type ReactNode } from 'react';
import { clsx } from 'clsx';

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block border border-lime text-lime font-mono uppercase',
        'text-[11px] tracking-[0.08em] px-[10px] py-[6px] rounded-[2px]',
        className,
      )}
    >
      {children}
    </span>
  );
}
