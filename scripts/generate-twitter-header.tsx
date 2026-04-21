import React from 'react';
import { ImageResponse } from 'next/og';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WIDTH = 1500;
const HEIGHT = 500;

async function main() {
  const root = process.cwd();
  const [heroBytes, archivoBytes, jbMonoBytes] = await Promise.all([
    readFile(join(root, 'apps/portal/public/hero-bg.png')),
    readFile(join(root, 'apps/portal/public/fonts/archivo-black-latin-400-normal.woff')),
    readFile(join(root, 'apps/portal/public/fonts/JetBrainsMono-Regular.ttf')),
  ]);
  const heroBase64 = `data:image/png;base64,${heroBytes.toString('base64')}`;

  const barcodeWidths = [
    3,1,2,1,3,2,1,1,3,1,2,3,1,1,2,1,3,1,1,2,3,1,2,1,1,3,2,1,1,3,
    1,2,1,3,2,1,1,2,3,1,2,1,3,1,1,2,1,3,2,1,1,3,1,2,3,1,1,2,1,3,
  ];

  const response = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          backgroundColor: '#f2f0e8',
          fontFamily: 'system-ui',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Double border frame */}
        <div style={{ position: 'absolute', top: 6, left: 6, right: 6, bottom: 6, border: '1px solid #c8c4bc', display: 'flex' }} />
        <div style={{ position: 'absolute', top: 14, left: 14, right: 14, bottom: 14, border: '1px solid #c8c4bc', display: 'flex' }} />

        {/* Corner brackets */}
        <div style={{ position: 'absolute', top: 10, left: 10, width: 10, height: 10, borderTop: '1px solid rgba(10,10,10,0.55)', borderLeft: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderTop: '1px solid rgba(10,10,10,0.55)', borderRight: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: 10, left: 10, width: 10, height: 10, borderBottom: '1px solid rgba(10,10,10,0.55)', borderLeft: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: 10, right: 10, width: 10, height: 10, borderBottom: '1px solid rgba(10,10,10,0.55)', borderRight: '1px solid rgba(10,10,10,0.55)', display: 'flex' }} />

        {/* Left section — SYS labels */}
        <div
          style={{
            position: 'absolute',
            top: 32,
            left: 36,
            display: 'flex',
            gap: 20,
            fontFamily: 'JetBrains Mono',
            fontSize: 9,
            color: 'rgba(10,10,10,0.7)',
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
            <span>STRATEGY → EXECUTE → LIVE</span>
          </div>
        </div>

        {/* Center content — hero + text side by side */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            gap: 48,
            padding: '0 80px',
          }}
        >
          {/* Hero image */}
          <img
            src={heroBase64}
            alt=""
            style={{
              width: '320px',
              height: '320px',
              objectFit: 'cover',
              objectPosition: 'center 20%',
            }}
          />

          {/* Text block */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                fontFamily: 'Archivo Black',
                fontSize: 72,
                fontWeight: 400,
                color: '#0a0a0a',
                letterSpacing: -3,
                lineHeight: 0.92,
              }}
            >
              SAEP
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 11,
                color: '#7a7772',
                letterSpacing: '0.08em',
                textTransform: 'uppercase' as const,
                marginTop: 4,
              }}
            >
              Solana Agent Economy Protocol
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 10,
                color: 'rgba(10,10,10,0.5)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase' as const,
                marginTop: 8,
              }}
            >
              register // stake // govern // earn
            </div>
          </div>
        </div>

        {/* Bottom-left: status labels */}
        <div
          style={{
            position: 'absolute',
            bottom: 30,
            left: 36,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontFamily: 'JetBrains Mono',
            fontSize: 9,
            color: 'rgba(10,10,10,0.7)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}
        >
          <span>AGENT LAYER ACTIVE</span>
          <span>REAL-TIME STATE</span>
          <span>EXECUTION PATH VERIFIED</span>
        </div>

        {/* Bottom-right: lime bar + barcode + labels */}
        <div
          style={{
            position: 'absolute',
            bottom: 26,
            right: 36,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 5,
          }}
        >
          <div style={{ height: 3, width: 48, backgroundColor: '#06f512', display: 'flex' }} />
          <div style={{ display: 'flex', gap: 0, alignItems: 'flex-end', height: 36 }}>
            {barcodeWidths.map((w, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: 36,
                  backgroundColor: i % 2 === 0 ? '#0a0a0a' : 'transparent',
                  display: 'flex',
                }}
              />
            ))}
          </div>
          <div
            style={{
              fontFamily: 'JetBrains Mono',
              fontSize: 9,
              color: 'rgba(10,10,10,0.6)',
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
              fontSize: 9,
              color: 'rgba(10,10,10,0.7)',
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
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Archivo Black', data: archivoBytes, style: 'normal' as const, weight: 400 as const },
        { name: 'JetBrains Mono', data: jbMonoBytes, style: 'normal' as const, weight: 400 as const },
      ],
    },
  );

  const buffer = Buffer.from(await response.arrayBuffer());
  const out = join(process.env.HOME!, 'Desktop', 'saep-twitter-header.png');
  await writeFile(out, buffer);
  console.log(`Written to ${out} (${WIDTH}x${HEIGHT})`);
}

main().catch(console.error);
