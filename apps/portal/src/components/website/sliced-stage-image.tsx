'use client';

import { useState } from 'react';

const SLICES = 5;

const OFFSET_SETS = [
  [-22, 16, -12, 24, -18],
  [18, -20, 14, -26, 22],
  [-16, 22, -24, 12, -18],
  [24, -14, 20, -22, 16],
  [-20, 18, -14, 26, -22],
  [14, -22, 18, -12, 24],
  [-26, 20, -16, 22, -14],
];

export function SlicedStageImage({
  index,
  flipped,
  alt,
  imageStyle,
}: {
  index: number;
  flipped: boolean;
  alt: string;
  imageStyle: React.CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const offsets = OFFSET_SETS[index % OFFSET_SETS.length]!;
  const src = `/stages/0_${index + 1}.png`;

  return (
    <div
      className="absolute inset-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {Array.from({ length: SLICES }).map((_, j) => {
        const top = (j * 100) / SLICES;
        const bottom = 100 - ((j + 1) * 100) / SLICES;
        const offset = offsets[j] ?? 0;
        const tx = hover ? offset : 0;
        return (
          <img
            key={j}
            src={src}
            alt={j === 0 ? alt : ''}
            aria-hidden={j !== 0}
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none transition-transform duration-[440ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
            style={{
              ...imageStyle,
              clipPath: `inset(${top}% 0 ${bottom}% 0)`,
              transform: `translate3d(${tx}px, 0, 0)${flipped ? ' scaleX(-1)' : ''}`,
              transitionDelay: `${j * 18}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
