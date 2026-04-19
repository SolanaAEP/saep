import type { Metadata } from 'next';
import { PageShell } from '@/components/page-shell';
import { GlitchButton } from '@saep/ui';

export const metadata: Metadata = {
  title: 'Brand',
  description: 'SAEP brand assets, design guidelines, color palette, typography, and downloadable files.',
};

const colors = [
  { token: '--paper',   hex: '#f2f0e8', label: 'Paper',     role: 'Background',      swatch: '#f2f0e8', border: true },
  { token: '--paper-2', hex: '#edebe3', label: 'Paper 2',   role: 'Elevated surface', swatch: '#edebe3', border: true },
  { token: '--ink',     hex: '#0a0a0a', label: 'Ink',       role: 'Primary text',     swatch: '#0a0a0a' },
  { token: '--ink-2',   hex: '#1a1a1a', label: 'Ink 2',     role: 'Secondary text',   swatch: '#1a1a1a' },
  { token: '--mute',    hex: '#7a7772', label: 'Mute',      role: 'Tertiary text',    swatch: '#7a7772' },
  { token: '--mute-2',  hex: '#a8a49c', label: 'Mute 2',    role: 'Disabled / placeholder', swatch: '#a8a49c' },
  { token: '--lime',    hex: '#06f512', label: 'Lime',      role: 'Brand accent',     swatch: '#06f512' },
  { token: '--danger',  hex: '#e8341c', label: 'Danger',    role: 'Error / destructive', swatch: '#e8341c' },
  { token: '--warning', hex: '#e8a81c', label: 'Warning',   role: 'Caution / pending', swatch: '#e8a81c' },
  { token: '--info',    hex: '#1c8ee8', label: 'Info',      role: 'Informational',    swatch: '#1c8ee8' },
];

const fonts = [
  { name: 'Archivo Black', role: 'Display', token: '--font-display', use: 'Headings, hero, wordmark', weight: '400 (visually heavy)', sample: 'SAEP PROTOCOL' },
  { name: 'JetBrains Mono', role: 'Monospace', token: '--font-mono', use: 'Labels, data, buttons, code', weight: '300–800', sample: 'SYS.OP.01 // ACTIVE' },
  { name: 'Inter', role: 'Body', token: '--font-body', use: 'Body copy, descriptions, forms', weight: '300–800', sample: 'Infrastructure for agents as economic actors on Solana.' },
];

const assets = [
  { file: 'logo.svg', label: 'Logomark', desc: 'Mark only. Stroke inherits currentColor. Lime accent squares.', href: '/logo.svg' },
  { file: 'wordmark.svg', label: 'Wordmark', desc: 'Full "SAEP" lockup with Archivo Black. Lime accent square.', href: '/wordmark.svg' },
  { file: 'logomark-bw.svg', label: 'Logomark B/W', desc: 'Black mark on transparent. For light backgrounds.', href: '/logomark-bw.svg' },
  { file: 'logomark-wb.svg', label: 'Logomark W/B', desc: 'White mark on transparent. For dark backgrounds.', href: '/logomark-wb.svg' },
  { file: 'logomark.png', label: 'Logomark PNG', desc: 'Rasterized mark. 2000×2000px.', href: '/logomark.png' },
  { file: 'barcode-ink.svg', label: 'Barcode (ink)', desc: 'Code128 barcode to buildonsaep.com. Dark variant.', href: '/barcode-ink.svg' },
  { file: 'barcode-paper.svg', label: 'Barcode (paper)', desc: 'Code128 barcode to buildonsaep.com. Light variant.', href: '/barcode-paper.svg' },
];

const rules = [
  { do: 'Use the mark with lime accent squares', dont: 'Remove or recolor the lime squares' },
  { do: 'Place on paper texture or solid paper/ink backgrounds', dont: 'Place on patterned or photographic backgrounds' },
  { do: 'Use lime sparingly — status dots, small accents, hover states', dont: 'Use lime as background fill for large areas' },
  { do: 'Keep all corners sharp (no border-radius)', dont: 'Round corners on containers, buttons, or marks' },
  { do: 'Use monospace uppercase for UI labels', dont: 'Mix label casing — all labels uppercase or none' },
  { do: 'Maintain clear space equal to the lime square around the mark', dont: 'Crowd the mark against other elements' },
];

export default function BrandPage() {
  return (
    <PageShell
      eyebrow="Resources"
      crumbs={[{ label: 'Brand' }]}
      title="Brand kit."
      lede="Marks, colors, type, and rules for representing SAEP. All assets are free to use when referencing the protocol. Download what you need."
    >
      {/* ── Marks ──────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Marks</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            SVG + PNG
          </span>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {/* Logomark preview */}
          <div className="border border-ink/10 flex flex-col">
            <div className="flex-1 flex items-center justify-center p-12 bg-paper-2">
              <img src="/logo.svg" alt="SAEP logomark" className="h-24 w-24" />
            </div>
            <div className="border-t border-ink/10 p-4 flex items-center justify-between">
              <div>
                <div className="font-display text-lg tracking-[-0.01em]">Logomark</div>
                <div className="font-mono text-[11px] text-mute mt-0.5">logo.svg — currentColor + lime accents</div>
              </div>
              <GlitchButton as="a" href="/logo.svg" download="saep-logomark.svg" size="sm">
                Download
              </GlitchButton>
            </div>
          </div>
          {/* Wordmark preview */}
          <div className="border border-ink/10 flex flex-col">
            <div className="flex-1 flex items-center justify-center p-12 bg-paper-2">
              <img src="/wordmark.svg" alt="SAEP wordmark" className="h-16 w-auto" />
            </div>
            <div className="border-t border-ink/10 p-4 flex items-center justify-between">
              <div>
                <div className="font-display text-lg tracking-[-0.01em]">Wordmark</div>
                <div className="font-mono text-[11px] text-mute mt-0.5">wordmark.svg — Archivo Black + lime accent</div>
              </div>
              <GlitchButton as="a" href="/wordmark.svg" download="saep-wordmark.svg" size="sm">
                Download
              </GlitchButton>
            </div>
          </div>
        </div>
        {/* Dark preview row */}
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <div className="border border-ink/10 flex flex-col">
            <div className="flex-1 flex items-center justify-center p-12 bg-ink">
              <img src="/logomark-wb.svg" alt="SAEP logomark white" className="h-24 w-24" />
            </div>
            <div className="border-t border-ink/10 p-4 flex items-center justify-between">
              <div>
                <div className="font-display text-lg tracking-[-0.01em]">Logomark — dark</div>
                <div className="font-mono text-[11px] text-mute mt-0.5">logomark-wb.svg — white on transparent</div>
              </div>
              <GlitchButton as="a" href="/logomark-wb.svg" download="saep-logomark-dark.svg" size="sm">
                Download
              </GlitchButton>
            </div>
          </div>
          <div className="border border-ink/10 flex flex-col">
            <div className="flex-1 flex items-center justify-center p-12 bg-paper-2">
              <img src="/logomark-bw.svg" alt="SAEP logomark black" className="h-24 w-24" />
            </div>
            <div className="border-t border-ink/10 p-4 flex items-center justify-between">
              <div>
                <div className="font-display text-lg tracking-[-0.01em]">Logomark — light</div>
                <div className="font-mono text-[11px] text-mute mt-0.5">logomark-bw.svg — black on transparent</div>
              </div>
              <GlitchButton as="a" href="/logomark-bw.svg" download="saep-logomark-light.svg" size="sm">
                Download
              </GlitchButton>
            </div>
          </div>
        </div>
      </section>

      {/* ── All assets ─────────────────────────────── */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">All assets</h2>
        </div>
        <div className="border border-ink/10">
          <div className="grid grid-cols-12 font-mono uppercase text-[11px] tracking-[0.08em] text-mute border-b border-ink/10 bg-ink/[0.03]">
            <div className="col-span-3 p-3">File</div>
            <div className="col-span-6 p-3">Description</div>
            <div className="col-span-3 p-3">Download</div>
          </div>
          {assets.map((a, i) => (
            <div
              key={a.file}
              className={`grid grid-cols-12 items-center ${i < assets.length - 1 ? 'border-b border-ink/5' : ''}`}
            >
              <div className="col-span-3 p-3 font-mono text-[12px]">{a.file}</div>
              <div className="col-span-6 p-3 text-[14px] text-ink/80">{a.desc}</div>
              <div className="col-span-3 p-3">
                <a
                  href={a.href}
                  download={`saep-${a.file}`}
                  className="font-mono uppercase text-[10px] tracking-[0.08em] border-b border-ink/40 hover:text-lime hover:border-lime"
                >
                  {a.file}
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Color ──────────────────────────────────── */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Color</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Design tokens
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {colors.map((c) => (
            <div key={c.token} className="flex flex-col">
              <div
                className={`h-20 ${c.border ? 'border border-ink/10' : ''}`}
                style={{ backgroundColor: c.swatch }}
              />
              <div className="mt-2 font-mono text-[11px] tracking-[0.02em]">{c.hex}</div>
              <div className="font-display text-[15px] tracking-[-0.01em] mt-0.5">{c.label}</div>
              <div className="font-mono text-[10px] text-mute mt-0.5">{c.role}</div>
            </div>
          ))}
        </div>
        <div className="mt-8 border-t border-ink/15 pt-6">
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute mb-3">Usage</div>
          <ul className="flex flex-col gap-2 text-[14px] text-ink/80 leading-relaxed">
            <li>— Lime is the only chromatic color. Use sparingly: status indicators, hover accents, small decorative marks.</li>
            <li>— Never use lime as readable text on paper backgrounds. Lime on ink (dark backgrounds) is text-safe.</li>
            <li>— Dark mode inverts paper/ink while lime stays constant.</li>
            <li>— All colors ship as named tokens in the SAEP design system and are available for integrators via the SDK.</li>
          </ul>
        </div>
      </section>

      {/* ── Typography ─────────────────────────────── */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Typography</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Self-hosted
          </span>
        </div>
        <div className="flex flex-col gap-10">
          {fonts.map((f) => (
            <div key={f.name} className="border-t border-ink/20 pt-6">
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <div className="font-display text-[20px] tracking-[-0.01em]">{f.name}</div>
                  <div className="font-mono text-[11px] text-mute mt-1">{f.use} — {f.weight}</div>
                </div>
                <span className="font-mono text-[11px] text-mute bg-ink/5 px-2 py-0.5">{f.role}</span>
              </div>
              <div
                className="text-[clamp(24px,3vw,40px)] leading-[1.1] tracking-[-0.01em]"
                style={{ fontFamily: `var(${f.token})` }}
              >
                {f.sample}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 border border-ink/10 bg-ink text-paper p-6">
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-paper/60 mb-3">Scale</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-[12px]">
            <div><span className="text-paper/50">hero</span> clamp(48px, 8vw, 112px)</div>
            <div><span className="text-paper/50">h1</span> clamp(36px, 5.5vw, 72px)</div>
            <div><span className="text-paper/50">h2</span> clamp(32px, 4.5vw, 56px)</div>
            <div><span className="text-paper/50">h3</span> clamp(24px, 3vw, 40px)</div>
            <div><span className="text-paper/50">body</span> 16px / 1.6</div>
            <div><span className="text-paper/50">ui</span> 14px</div>
            <div><span className="text-paper/50">label</span> 11px uppercase</div>
            <div><span className="text-paper/50">micro</span> 10px uppercase</div>
          </div>
        </div>
      </section>

      {/* ── Visual Language ─────────────────────────── */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Visual language</h2>
        </div>
        <div className="grid md:grid-cols-12 gap-10 items-start">
          <div className="md:col-span-5">
            <p className="text-[16px] leading-relaxed text-ink/80">
              The SAEP aesthetic is CRT-terminal meets newsprint: paper textures, monospace labels,
              halftone patterns, scanlines, and a single neon accent.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {[
                { motif: 'Halftone dot grids', meaning: 'Data density, machine vision' },
                { motif: 'Barcode fragments', meaning: 'Machine-readable identity' },
                { motif: 'Lime accent blocks', meaning: 'Status indicators, tiny LEDs' },
                { motif: 'Chromatic aberration', meaning: 'The glitch ghost on hover' },
                { motif: 'Protocol frame', meaning: 'Double border + corner brackets' },
                { motif: 'Paper texture', meaning: 'Physical substrate, not flat digital' },
              ].map((m) => (
                <div key={m.motif} className="flex gap-3 text-[14px]">
                  <span className="text-lime font-mono text-[11px] mt-0.5">+</span>
                  <div>
                    <span className="font-display tracking-[-0.01em]">{m.motif}</span>
                    <span className="text-ink/60"> — {m.meaning}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="md:col-span-7 border border-ink/10 bg-ink text-paper p-8">
            <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-paper/50 mb-4">
              Spacing grid
            </div>
            <div className="flex flex-col gap-3">
              {[
                { px: 4, label: 'xs' },
                { px: 8, label: 'sm' },
                { px: 16, label: 'md' },
                { px: 24, label: 'lg' },
                { px: 32, label: 'xl' },
                { px: 48, label: '2xl' },
                { px: 64, label: '3xl' },
                { px: 96, label: '4xl' },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-paper/50 w-8 text-right">{s.px}</span>
                  <div className="bg-lime/80 h-2" style={{ width: s.px }} />
                  <span className="font-mono text-[10px] text-paper/40">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Do / Don't ─────────────────────────────── */}
      <section className="mt-20">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Do / Don&apos;t</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-4">
              <div className="border-t-2 border-lime pt-4">
                <div className="font-mono uppercase text-[10px] tracking-[0.08em] text-lime mb-2">Do</div>
                <p className="text-[14px] text-ink/80 leading-relaxed">{r.do}</p>
              </div>
              <div className="border-t-2 border-danger pt-4">
                <div className="font-mono uppercase text-[10px] tracking-[0.08em] text-danger mb-2">Don&apos;t</div>
                <p className="text-[14px] text-ink/80 leading-relaxed">{r.dont}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── License & Contact ─────────────────────── */}
      <section className="mt-20">
        <div className="border border-ink/70 bg-paper p-6 md:p-8">
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            Usage
          </div>
          <p className="mt-4 text-[15px] text-ink/80 leading-relaxed max-w-2xl">
            SAEP brand assets are free to use when accurately referencing the protocol.
            Do not alter the marks, imply endorsement, or use them in ways that could
            confuse users about official affiliation. For partnership or co-branding
            inquiries, reach out.
          </p>
          <div className="mt-6 flex gap-6 font-mono uppercase text-[11px] tracking-[0.08em]">
            <a
              href="https://github.com/SolanaAEP/saep"
              className="border-b border-ink hover:text-lime hover:border-lime"
            >
              GitHub
            </a>
            <a
              href="mailto:security@buildonsaep.com"
              className="border-b border-ink hover:text-lime hover:border-lime"
            >
              Contact
            </a>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
