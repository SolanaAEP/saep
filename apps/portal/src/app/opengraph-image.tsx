import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'SAEP — Solana Agent Economy Protocol';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#f2f0e8',
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
            opacity: 0.07,
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
            width: '40px',
            height: '40px',
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
            width: '40px',
            height: '40px',
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
            width: '40px',
            height: '40px',
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
            width: '40px',
            height: '40px',
            borderBottom: '3px solid #1a1a1a',
            borderRight: '3px solid #1a1a1a',
            display: 'flex',
          }}
        />

        {/* Lime accent square top-left */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            left: '80px',
            width: '10px',
            height: '10px',
            backgroundColor: '#06f512',
            display: 'flex',
          }}
        />

        {/* Lime accent line left side */}
        <div
          style={{
            position: 'absolute',
            top: '200px',
            left: '24px',
            width: '3px',
            height: '60px',
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                fontSize: '24px',
                fontWeight: 900,
                letterSpacing: '-1px',
                color: '#1a1a1a',
              }}
            >
              SAEP
            </div>
            <div
              style={{
                width: '6px',
                height: '6px',
                backgroundColor: '#06f512',
                borderRadius: '50%',
                display: 'flex',
              }}
            />
            <div
              style={{
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#888',
                letterSpacing: '1px',
              }}
            >
              v0.1
            </div>
          </div>

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

        {/* Center content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            flex: 1,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: '120px',
              fontWeight: 900,
              color: '#1a1a1a',
              letterSpacing: '-6px',
              lineHeight: 1,
            }}
          >
            SAEP
          </div>
          <div
            style={{
              fontSize: '18px',
              fontFamily: 'monospace',
              color: '#555',
              marginTop: '20px',
              letterSpacing: '3px',
              textTransform: 'uppercase',
            }}
          >
            Autonomous agent infrastructure
          </div>
          <div
            style={{
              fontSize: '14px',
              fontFamily: 'monospace',
              color: '#888',
              marginTop: '8px',
              letterSpacing: '1px',
            }}
          >
            register // stake // govern // earn
          </div>
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
              height: '28px',
            }}
          >
            {Array.from({ length: 64 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: i % 7 === 0 ? '4px' : '2px',
                  height: `${10 + ((i * 13) % 18)}px`,
                  backgroundColor: i % 9 === 0 ? '#06f512' : '#1a1a1a',
                  opacity: i % 3 === 0 ? 0.9 : 0.35,
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
                  padding: '4px 10px',
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
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: '#888',
                }}
              >
                EPOCH: 742
              </div>
            </div>

            <div
              style={{
                fontSize: '14px',
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
    { ...size }
  );
}
