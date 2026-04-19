import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react';

type BaseProps = {
  children: ReactNode;
  variant?: 'outline' | 'solid';
  size?: 'sm' | 'md';
};

type AsButton = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & { as?: 'button'; href?: never };
type AsAnchor = BaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & { as: 'a' };

type Props = AsButton | AsAnchor;

export function GlitchButton({ children, variant = 'outline', size = 'md', ...rest }: Props) {
  const base = [
    'btn-glitch',
    variant === 'solid' ? 'btn-glitch--solid' : '',
    size === 'sm' ? 'btn-glitch--sm' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const cls = rest.className ? `${base} ${rest.className}` : base;
  const text = typeof children === 'string' ? children : undefined;

  const inner = <span data-text={text}>{children}</span>;

  if (rest.as === 'a') {
    const { as: _, ...anchorProps } = rest as AsAnchor;
    return (
      <a {...anchorProps} className={cls}>
        {inner}
      </a>
    );
  }

  const { as: _, ...buttonProps } = rest as AsButton;
  return (
    <button type="button" {...buttonProps} className={cls}>
      {inner}
    </button>
  );
}
