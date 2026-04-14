export function HeroComposition() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 500"
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="halftone" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.1" fill="var(--ink)" />
        </pattern>
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.18 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>

      <path
        d="M 110 120 C 70 160 60 230 95 290 C 120 340 180 380 240 370 C 310 360 350 300 340 230 C 332 170 290 120 230 108 C 185 100 140 100 110 120 Z"
        fill="url(#halftone)"
        opacity="0.85"
      />
      <path
        d="M 110 120 C 70 160 60 230 95 290 C 120 340 180 380 240 370 C 310 360 350 300 340 230 C 332 170 290 120 230 108 C 185 100 140 100 110 120 Z"
        filter="url(#noise)"
      />

      <rect x="60" y="190" width="120" height="14" fill="var(--ink)" />
      <rect x="230" y="260" width="80" height="6" fill="var(--ink)" />
      <polygon points="280,140 340,140 325,170 280,170" fill="var(--ink)" />
      <rect x="150" y="320" width="46" height="46" fill="var(--ink)" />

      <rect x="305" y="185" width="12" height="12" fill="var(--lime)" />
      <line x1="200" y1="370" x2="200" y2="470" stroke="var(--lime)" strokeWidth="2" />
      <circle cx="130" cy="240" r="5" fill="var(--lime)" />
    </svg>
  );
}
