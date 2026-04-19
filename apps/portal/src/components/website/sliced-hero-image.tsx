'use client';

const BASE_OFFSETS = [-36, 28, -22, 40, -30, 24, -34, 32, -26, 22];

export function SlicedHeroImage({
  navHovered,
  itemCenters,
}: {
  navHovered: boolean;
  itemCenters: number[];
}) {
  const boundaries: number[] = [];
  if (itemCenters.length > 1) {
    for (let i = 0; i < itemCenters.length - 1; i += 1) {
      const a = itemCenters[i]!;
      const b = itemCenters[i + 1]!;
      boundaries.push((a + b) / 2);
    }
  }

  const sliceCount = itemCenters.length > 0 ? itemCenters.length : 1;
  const slices = Array.from({ length: sliceCount }).map((_, i) => {
    const top = i === 0 ? 0 : boundaries[i - 1]!;
    const bottom = i === sliceCount - 1 ? 100 : boundaries[i]!;
    return { top, bottom };
  });

  return (
    <div
      className="relative inline-block"
      style={{
        maskImage: 'radial-gradient(ellipse 70% 65% at 50% 50%, black 40%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 65% at 50% 50%, black 40%, transparent 100%)',
      }}
      aria-hidden="true"
    >
      <img
        src="/hero-bg.jpg"
        alt=""
        className="block h-[min(78vh,720px)] w-auto object-contain invisible select-none pointer-events-none"
        draggable={false}
      />
      {slices.map((slice, i) => {
        const offset = BASE_OFFSETS[i % BASE_OFFSETS.length] ?? 0;
        const tx = navHovered ? 0 : offset;
        return (
          <img
            key={i}
            src="/hero-bg.jpg"
            alt=""
            draggable={false}
            className="absolute inset-0 block h-full w-full object-contain select-none pointer-events-none transition-transform duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
            style={{
              clipPath: `inset(${slice.top}% 0 ${100 - slice.bottom}% 0)`,
              transform: `translate3d(${tx}px, 0, 0)`,
              transitionDelay: `${i * 24}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
