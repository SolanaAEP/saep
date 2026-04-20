import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };

interface OgOptions {
  title: string;
  subtitle?: string;
  tag?: string;
}

export function generateOgImage({ title, subtitle, tag }: OgOptions) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#faefc9',
          padding: '48px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Dot grid pattern */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexWrap: 'wrap',
            opacity: 0.08,
          }}
        >
          {Array.from({ length: 600 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '3px',
                  height: '3px',
                  borderRadius: '50%',
                  backgroundColor: '#1a1a1a',
                }}
              />
            </div>
          ))}
        </div>

        {/* Corner brackets - top left */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            left: '24px',
            width: '32px',
            height: '32px',
            borderTop: '3px solid #1a1a1a',
            borderLeft: '3px solid #1a1a1a',
            display: 'flex',
          }}
        />
        {/* Corner brackets - top right */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            right: '24px',
            width: '32px',
            height: '32px',
            borderTop: '3px solid #1a1a1a',
            borderRight: '3px solid #1a1a1a',
            display: 'flex',
          }}
        />
        {/* Corner brackets - bottom left */}
        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            left: '24px',
            width: '32px',
            height: '32px',
            borderBottom: '3px solid #1a1a1a',
            borderLeft: '3px solid #1a1a1a',
            display: 'flex',
          }}
        />
        {/* Corner brackets - bottom right */}
        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            right: '24px',
            width: '32px',
            height: '32px',
            borderBottom: '3px solid #1a1a1a',
            borderRight: '3px solid #1a1a1a',
            display: 'flex',
          }}
        />

        {/* Lime accent bar */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            left: '72px',
            width: '8px',
            height: '8px',
            backgroundColor: '#06f512',
            display: 'flex',
          }}
        />

        {/* Header row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            width: '100%',
            zIndex: 1,
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                fontSize: '28px',
                fontWeight: 900,
                letterSpacing: '-1px',
                color: '#1a1a1a',
              }}
            >
              SAEP
            </div>
            <div
              style={{
                width: '4px',
                height: '4px',
                backgroundColor: '#06f512',
                borderRadius: '50%',
                display: 'flex',
              }}
            />
          </div>

          {/* Protocol label */}
          <div
            style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              color: '#666',
              letterSpacing: '1px',
              textAlign: 'right',
            }}
          >
            SOLANA AGENT ECONOMY PROTOCOL
          </div>
        </div>

        {/* Tag line */}
        {tag && (
          <div
            style={{
              display: 'flex',
              marginTop: '24px',
              zIndex: 1,
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontFamily: 'monospace',
                color: '#888',
                letterSpacing: '2px',
                textTransform: 'uppercase',
              }}
            >
              {tag}
            </div>
          </div>
        )}

        {/* Center content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-start',
            flex: 1,
            zIndex: 1,
            paddingLeft: '16px',
          }}
        >
          <div
            style={{
              fontSize: '72px',
              fontWeight: 900,
              color: '#1a1a1a',
              letterSpacing: '-3px',
              lineHeight: 1,
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: '20px',
                fontFamily: 'monospace',
                color: '#555',
                marginTop: '16px',
                letterSpacing: '0.5px',
              }}
            >
              {subtitle}
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            zIndex: 1,
          }}
        >
          {/* Barcode-style lines */}
          <div
            style={{
              display: 'flex',
              gap: '2px',
              alignItems: 'flex-end',
              height: '24px',
            }}
          >
            {Array.from({ length: 48 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: i % 5 === 0 ? '4px' : '2px',
                  height: `${12 + ((i * 7) % 12)}px`,
                  backgroundColor: i % 11 === 0 ? '#06f512' : '#1a1a1a',
                  opacity: i % 3 === 0 ? 0.9 : 0.4,
                  display: 'flex',
                }}
              />
            ))}
          </div>

          {/* Footer row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: '24px',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: '#06f512',
                  backgroundColor: '#1a1a1a',
                  padding: '3px 8px',
                  borderRadius: '2px',
                }}
              >
                SYS[OK]
              </div>
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: '#888',
                }}
              >
                CLUSTER: DEVNET
              </div>
            </div>

            <div
              style={{
                fontSize: '13px',
                fontFamily: 'monospace',
                color: '#555',
                letterSpacing: '1px',
              }}
            >
              buildonsaep.com
            </div>
          </div>
        </div>
      </div>
    ),
    { ...ogSize }
  );
}
