import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };

interface OgOptions {
  title: string;
  subtitle?: string;
  tag?: string;
}

const PAPER = '#f2f0e8';
const INK = '#121212';
const MUTE = '#6f6a63';
const LINE = '#cfc8be';
const LIME = '#06f512';

export function generateOgImage({ title, subtitle, tag }: OgOptions) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: PAPER,
          color: INK,
          padding: '32px',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '12px',
            border: `1px solid ${LINE}`,
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: '24px',
            border: `1px solid ${LINE}`,
            display: 'flex',
          }}
        />

        <div
          style={{
            position: 'absolute',
            top: '18px',
            left: '18px',
            width: '18px',
            height: '18px',
            borderTop: `2px solid ${INK}`,
            borderLeft: `2px solid ${INK}`,
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            width: '18px',
            height: '18px',
            borderTop: `2px solid ${INK}`,
            borderRight: `2px solid ${INK}`,
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '18px',
            left: '18px',
            width: '18px',
            height: '18px',
            borderBottom: `2px solid ${INK}`,
            borderLeft: `2px solid ${INK}`,
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '18px',
            right: '18px',
            width: '18px',
            height: '18px',
            borderBottom: `2px solid ${INK}`,
            borderRight: `2px solid ${INK}`,
            display: 'flex',
          }}
        />

        <div
          style={{
            position: 'absolute',
            top: '46px',
            left: '52px',
            width: '8px',
            height: '8px',
            backgroundColor: LIME,
            display: 'flex',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: '44px',
            right: '44px',
            top: '88px',
            height: '1px',
            backgroundColor: LINE,
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '44px',
            right: '44px',
            bottom: '92px',
            height: '1px',
            backgroundColor: LINE,
            display: 'flex',
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            padding: '20px 28px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
              }}
            >
              <div
                style={{
                  fontSize: '38px',
                  fontWeight: 900,
                  letterSpacing: '-0.05em',
                  display: 'flex',
                }}
              >
                SAEP
              </div>
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '999px',
                  backgroundColor: LIME,
                  display: 'flex',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '6px',
                fontSize: '12px',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: MUTE,
              }}
            >
              <div style={{ display: 'flex' }}>Solana Agent Economy Protocol</div>
              <div style={{ display: 'flex' }}>buildonsaep.com</div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '48px',
              flex: 1,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: '20px',
                maxWidth: '720px',
                height: '100%',
              }}
            >
              {tag ? (
                <div
                  style={{
                    display: 'flex',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    textTransform: 'uppercase',
                    letterSpacing: '0.18em',
                    color: MUTE,
                  }}
                >
                  {tag}
                </div>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  fontSize: title.length > 18 ? '72px' : '84px',
                  lineHeight: 0.94,
                  fontWeight: 900,
                  letterSpacing: '-0.06em',
                }}
              >
                {title}
              </div>
              {subtitle ? (
                <div
                  style={{
                    display: 'flex',
                    maxWidth: '680px',
                    fontSize: '26px',
                    lineHeight: 1.3,
                    color: MUTE,
                  }}
                >
                  {subtitle}
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: '12px',
                minWidth: '220px',
              }}
            >
              {[
                ['01', 170, INK],
                ['02', 134, '#343434'],
                ['03', 188, LIME],
                ['04', 116, '#6f6a63'],
                ['05', 154, INK],
                ['06', 98, '#8e877e'],
              ].map(([label, width, color]) => (
                <div
                  key={String(label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      width: '24px',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      color: MUTE,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      width: `${width}px`,
                      height: '10px',
                      backgroundColor: String(color),
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '12px',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: MUTE,
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '999px',
                  backgroundColor: LIME,
                  display: 'flex',
                }}
              />
              Protocol live
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: '12px',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: MUTE,
              }}
            >
              Onchain coordination rail
            </div>
          </div>
        </div>
      </div>
    ),
    { ...ogSize }
  );
}
