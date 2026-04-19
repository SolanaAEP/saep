# SAEP Brand

Canonical marks and design language for the Solana Agent Economy Protocol.

## Marks

| File | Use |
|---|---|
| `logo.svg` | Mark only — favicon, app icon, compact headers. Stroke inherits `currentColor`. |
| `wordmark.svg` | Full lockup for headers and footer. Uses Archivo Black (self-host via `@fontsource/archivo-black`). |

Both marks use `currentColor` for the primary shape, making them adaptable to light and dark contexts. The lime accent squares are always `#06f512`.

## Color

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#f2f0e8` | Background (light mode) |
| `--paper-2` | `#edebe3` | Elevated surface |
| `--paper-3` | `#e5e3db` | Recessed surface |
| `--ink` | `#0a0a0a` | Primary text and borders |
| `--ink-2` | `#1a1a1a` | Secondary text |
| `--mute` | `#7a7772` | Tertiary text, captions |
| `--mute-2` | `#a8a49c` | Disabled, placeholder |
| `--lime` | `#06f512` | Accent — the only chromatic color |
| `--lime-dim` | `#05c40e` | Accent on active states |
| `--danger` | `#e8341c` | Error, destructive actions |
| `--warning` | `#e8a81c` | Caution, pending states |
| `--info` | `#1c8ee8` | Informational callouts |

Lime is the brand signal. Use sparingly — status indicators, hover accents, small decorative marks. Never as a background fill for large surfaces.

Dark mode inverts paper/ink while lime stays constant.

## Typography

| Stack | Font | Weight | Use |
|---|---|---|---|
| `--font-display` | Archivo Black | 400 (visually heavy) | Headings, hero text, the wordmark |
| `--font-mono` | JetBrains Mono Variable | 300–800 | Labels, data, buttons, code, technical text |
| `--font-body` | Inter Variable | 300–800 | Body copy, descriptions, form text |

All fonts self-hosted via `@fontsource`. No external CDN loads.

### Scale

| Token | Value | Use |
|---|---|---|
| `--text-hero` | `clamp(48px, 8vw, 112px)` | Landing hero |
| `--text-h1` | `clamp(36px, 5.5vw, 72px)` | Page headings |
| `--text-h2` | `clamp(32px, 4.5vw, 56px)` | Section headings |
| `--text-h3` | `clamp(24px, 3vw, 40px)` | Subsection headings |
| `--text-label` | `11px` | Monospace UI labels (uppercase) |
| `--text-micro` | `10px` | System annotations |

Display text: tight leading (0.92), tight tracking (-0.01em).
Mono labels: wide tracking (0.08em), uppercase.

## Visual Language

The SAEP aesthetic is **CRT-terminal meets newsprint**: paper textures, monospace labels, halftone patterns, scanlines, and a single neon accent.

**Key motifs** (from `GlitchComposition`):
- Halftone dot grids — data density
- Barcode fragments — machine-readable identity
- Lime accent blocks — status indicators, tiny LEDs
- Chromatic aberration — the glitch ghost on hover
- Plus marks (+) — crosshair/targeting vocabulary

**Protocol frame**: Double-line border with corner brackets. Present on all pages. Communicates "you are inside the protocol."

## Button

The `GlitchButton` component (`@saep/ui`) is the primary interactive element:
- Black border, monospace uppercase text, transparent background
- Tiny lime pip in top-right corner (LED indicator)
- Hover: halftone dot overlay shifts, scanline sweeps, text jitters with lime chromatic ghost
- Active: inverts to ink background, paper text
- Variants: `outline` (default), `solid` (lime border/text, fills on hover), `ghost` (borderless)
- Sizes: `sm` (34px), `md` (42px), `lg` (50px)

## Usage Rules

1. Lime on paper (light bg): decorative only — borders, small blocks, dots. Never for readable text.
2. Lime on ink (dark bg): text-safe. Use for status labels, active states, links.
3. The mark's lime squares are always present. Don't render the mark without them.
4. Paper texture (`paper-texture.png`) repeats on all backgrounds. Never use a flat color.
5. All borders are sharp (no border-radius) except code inline badges (`2px`).
6. Spacing follows an 8px grid: 4, 8, 16, 24, 32, 48, 64, 96.

## Source of Truth

All tokens defined in `packages/config/tailwind/tokens.css`.
Shared patterns in `packages/config/tailwind/shared.css`.
Components in `packages/ui/src/`.
