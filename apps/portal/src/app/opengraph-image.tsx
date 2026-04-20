import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const alt = 'SAEP — Solana Agent Economy Protocol';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const [heroBytes, archivoBytes, jbMonoBytes] = await Promise.all([
    readFile(join(process.cwd(), 'public', 'hero-bg.png')),
    readFile(join(process.cwd(), 'public', 'fonts', 'archivo-black-latin-400-normal.woff')),
    readFile(join(process.cwd(), 'public', 'fonts', 'JetBrainsMono-Regular.ttf')),
  ]);
  const heroBase64 = `data:image/png;base64,${heroBytes.toString('base64')}`;

  const barcodeWidths = [
    3,1,2,1,3,2,1,1,3,1,2,3,1,1,2,1,3,1,1,2,3,1,2,1,1,3,2,1,1,3,
    1,2,1,3,2,1,1,2,3,1,2,1,3,1,1,2,1,3,2,1,1,3,1,2,3,1,1,2,1,3,
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#faefc9',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Double border frame — matches homepage */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            bottom: 8,
            border: '1px solid #c8c4bc',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 18,
            left: 18,
            right: 18,
            bottom: 18,
            border: '1px solid #c8c4bc',
            display: 'flex',
          }}
        />

        {/* Corner brackets */}
        <div style={{ position: 'absolute', top: 14, left: 14, width: 12, height: 12, borderTop: '1px solid rgba(10,10,10,0.55)', borderLeft: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: 14, right: 14, width: 12, height: 12, borderTop: '1px solid rgba(10,10,10,0.55)', borderRight: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: 14, left: 14, width: 12, height: 12, borderBottom: '1px solid rgba(10,10,10,0.55)', borderLeft: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: 14, right: 14, width: 12, height: 12, borderBottom: '1px solid rgba(10,10,10,0.55)', borderRight: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />

        {/* Top-left: SYS labels — matches homepage */}
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 44,
            display: 'flex',
            gap: 24,
            fontFamily: 'JetBrains Mono',
            fontSize: 10,
            color: 'rgba(10,10,10,0.8)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>SYS.OP.01</span>
            <span>SEQ.994.2</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>INTENT → AGENT →</span>
            <span>STRATEGY → EXECUTE →</span>
            <span>LIVE</span>
          </div>
        </div>

        {/* Center — hero image above heading */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            position: 'relative',
            paddingTop: 40,
          }}
        >
          <img
            src={heroBase64}
            alt=""
            style={{
              width: '360px',
              height: '360px',
              objectFit: 'cover',
              objectPosition: 'center 20%',
            }}
          />
          <div
            style={{
              fontFamily: 'Archivo Black',
              fontSize: 64,
              fontWeight: 400,
              color: '#0a0a0a',
              letterSpacing: -2,
              lineHeight: 0.92,
              marginTop: 8,
            }}
          >
            SAEP
          </div>
          <div
            style={{
              fontFamily: 'JetBrains Mono',
              fontSize: 11,
              color: '#7a7772',
              marginTop: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
            }}
          >
            Solana Agent Economy Protocol
          </div>
        </div>

        {/* Bottom-left: status labels */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: 44,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontFamily: 'JetBrains Mono',
            fontSize: 10,
            color: 'rgba(10,10,10,0.8)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}
        >
          <span>AGENT LAYER ACTIVE</span>
          <span>REAL-TIME STATE</span>
          <span>EXECUTION PATH VERIFIED</span>
        </div>

        {/* Bottom-right: lime bar + barcode + labels — matches homepage */}
        <div
          style={{
            position: 'absolute',
            bottom: 36,
            right: 40,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
          }}
        >
          {/* Lime accent bar */}
          <div style={{ height: 4, width: 64, backgroundColor: '#06f512', display: 'flex' }} />

          {/* Code128-style barcode */}
          <div style={{ display: 'flex', gap: 0, alignItems: 'flex-end', height: 48 }}>
            {barcodeWidths.map((w, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: 48,
                  backgroundColor: i % 2 === 0 ? '#0a0a0a' : 'transparent',
                  display: 'flex',
                }}
              />
            ))}
          </div>

          <div
            style={{
              fontFamily: 'JetBrains Mono',
              fontSize: 10,
              color: 'rgba(10,10,10,0.7)',
              letterSpacing: '0.1em',
            }}
          >
            0101001 / 010001
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 2,
              fontFamily: 'JetBrains Mono',
              fontSize: 10,
              color: 'rgba(10,10,10,0.8)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
            }}
          >
            <span>SOLANA AGENT ECONOMY PROTOCOL</span>
            <span>V.2.0.0 // PROTOCOL LIVE</span>
            <span>ALL SYSTEMS NOMINAL</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'Archivo Black',
          data: archivoBytes,
          style: 'normal' as const,
          weight: 400 as const,
        },
        {
          name: 'JetBrains Mono',
          data: jbMonoBytes,
          style: 'normal' as const,
          weight: 400 as const,
        },
      ],
    },
  );
}
