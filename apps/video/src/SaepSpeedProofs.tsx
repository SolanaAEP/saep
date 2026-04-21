import './styles.css';

import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type Layout = 'landscape' | 'portrait';

type Props = {
  layout: Layout;
  voiceoverSrc?: string | null;
  voiceoverPlaybackRate?: number;
};

const INTRO = 150;
const HIRE_SCENE = 273;
const BRIDGE_SCENE = 198;
const SWARM_SCENE = 144;
const OUTRO = 195;

export const TOTAL_FRAMES = INTRO + HIRE_SCENE + BRIDGE_SCENE + SWARM_SCENE + OUTRO;

const palette = {
  paper: '#f3efe7',
  paperEdge: '#e7e1d6',
  ink: '#090909',
  softInk: 'rgba(9, 9, 9, 0.7)',
  mutedInk: 'rgba(9, 9, 9, 0.52)',
  line: 'rgba(9, 9, 9, 0.12)',
  lineStrong: 'rgba(9, 9, 9, 0.22)',
  whiteGlass: 'rgba(255, 255, 255, 0.44)',
  lime: '#4cff52',
  limeSoft: 'rgba(76, 255, 82, 0.18)',
};

const display = 'var(--font-display)';
const body = 'var(--font-body)';
const mono = 'var(--font-mono)';

const sceneOffsets = {
  intro: 0,
  hire: INTRO,
  bridge: INTRO + HIRE_SCENE,
  swarm: INTRO + HIRE_SCENE + BRIDGE_SCENE,
  outro: INTRO + HIRE_SCENE + BRIDGE_SCENE + SWARM_SCENE,
};

const agents = {
  hero: {src: staticFile('agents/desktop-hero.png'), position: 'center'},
  a: {src: staticFile('agents/desktop-agent-a.png'), position: 'center'},
  b: {src: staticFile('agents/desktop-agent-b.png'), position: 'center'},
  c: {src: staticFile('agents/desktop-agent-c.png'), position: 'center'},
  d: {src: staticFile('agents/desktop-agent-d.png'), position: 'center'},
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const rise = (frame: number, fps: number, delay = 0, damping = 18) =>
  spring({
    fps,
    frame: Math.max(0, frame - delay),
    config: {
      damping,
      stiffness: 120,
      mass: 0.9,
    },
  });

const sceneFrame = (frame: number, start: number) => Math.max(0, frame - start);

const entranceStyle = (progress: number, offsetY = 26, startScale = 0.985): React.CSSProperties => ({
  opacity: progress,
  transform: `translateY(${interpolate(progress, [0, 1], [offsetY, 0])}px) scale(${interpolate(
    progress,
    [0, 1],
    [startScale, 1],
  )})`,
});

const layoutFor = (portrait: boolean) => ({
  inset: portrait ? 56 : 42,
  innerInset: portrait ? 74 : 58,
  left: portrait ? 78 : 86,
  right: portrait ? 78 : 86,
  top: portrait ? 112 : 72,
  bottom: portrait ? 128 : 72,
});

const Barcode = ({portrait}: {portrait: boolean}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
      }}
    >
      <div style={{width: portrait ? 60 : 48, height: 4, background: palette.lime}} />
      <div
        style={{
          width: portrait ? 148 : 106,
          height: portrait ? 38 : 32,
          backgroundImage:
            'repeating-linear-gradient(to right, rgba(9,9,9,0.96) 0 2px, transparent 2px 4px, rgba(9,9,9,0.96) 4px 6px, transparent 6px 8px)',
        }}
      />
      <div
        style={{
          fontFamily: mono,
          fontSize: portrait ? 12 : 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: palette.mutedInk,
          textAlign: 'right',
          lineHeight: 1.45,
        }}
      >
        <div>0101001 / 010001</div>
        <div>V.2.0.0 / protocol live</div>
      </div>
    </div>
  );
};

const FrameChrome = ({frame, portrait}: {frame: number; portrait: boolean}) => {
  const layout = layoutFor(portrait);
  const drift = Math.sin(frame / 36) * 6;

  return (
    <>
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(circle at 18% 30%, rgba(76,255,82,0.07), transparent 24%),
            radial-gradient(circle at 80% 40%, rgba(9,9,9,0.04), transparent 18%),
            linear-gradient(180deg, ${palette.paper} 0%, ${palette.paperEdge} 100%)
          `,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.26,
          backgroundImage:
            'radial-gradient(circle, rgba(0,0,0,0.18) 0 0.8px, transparent 0.8px 100%)',
          backgroundSize: portrait ? '18px 18px' : '19px 19px',
          transform: `translate(${drift}px, ${drift * 0.25}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.14,
          backgroundImage: 'linear-gradient(rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.08) 1px, transparent 1px)',
          backgroundSize: portrait ? '84px 84px' : '96px 96px',
        }}
      />
      <div style={{position: 'absolute', inset: layout.inset, border: `1px solid ${palette.lineStrong}`}} />
      <div style={{position: 'absolute', inset: layout.innerInset, border: `1px solid ${palette.line}`}} />
      {[
        {left: layout.innerInset - 8, top: layout.innerInset - 8},
        {right: layout.innerInset - 8, top: layout.innerInset - 8},
        {left: layout.innerInset - 8, bottom: layout.innerInset - 8},
        {right: layout.innerInset - 8, bottom: layout.innerInset - 8},
      ].map((corner, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            width: 18,
            height: 18,
            borderTop: `2px solid ${palette.ink}`,
            borderLeft: `2px solid ${palette.ink}`,
            opacity: 0.4,
            transform:
              index === 0
                ? undefined
                : index === 1
                  ? 'scaleX(-1)'
                  : index === 2
                    ? 'scaleY(-1)'
                    : 'scale(-1)',
            ...corner,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: layout.left,
          top: layout.top,
          display: 'grid',
          gap: 4,
          fontFamily: mono,
          fontSize: portrait ? 13 : 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: palette.mutedInk,
        }}
      >
        <div>SYS.OP.01 &nbsp; INTENT &gt; AGENT &gt;</div>
        <div>SEQ.994.2 &nbsp; STRATEGY &gt; EXECUTE &gt; LIVE</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: layout.left,
          bottom: layout.bottom,
          fontFamily: mono,
          fontSize: portrait ? 13 : 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: palette.mutedInk,
          lineHeight: 1.55,
        }}
      >
        <div>AGENT LAYER ACTIVE</div>
        <div>REAL-TIME STATE</div>
        <div>EXECUTION PATH VERIFIED</div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: layout.right,
          bottom: layout.bottom - 6,
          display: 'grid',
          justifyItems: 'end',
          gap: 10,
        }}
      >
        <Barcode portrait={portrait} />
        <div
          style={{
            fontFamily: mono,
            fontSize: portrait ? 13 : 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: palette.mutedInk,
            textAlign: 'right',
            lineHeight: 1.55,
          }}
        >
          <div>SAEP / SOLANA AGENT ECONOMY PROTOCOL</div>
          <div>ALL SYSTEMS NOMINAL</div>
        </div>
      </div>
    </>
  );
};

const FloatingMarks = ({frame, portrait}: {frame: number; portrait: boolean}) => {
  const nodes = portrait
    ? [
        {left: 140, top: 300, size: 16},
        {left: 760, top: 420, size: 10},
        {left: 830, top: 1120, size: 18},
        {left: 160, top: 1440, size: 10},
      ]
    : [
        {left: 640, top: 196, size: 16},
        {left: 732, top: 258, size: 9},
        {left: 864, top: 238, size: 11},
        {left: 910, top: 386, size: 12},
        {left: 1740, top: 764, size: 14},
      ];

  return (
    <>
      {nodes.map((node, index) => {
        const wobble = Math.sin((frame + index * 8) / 10) * 3;
        return (
          <div
            key={`${node.left}-${node.top}`}
            style={{
              position: 'absolute',
              left: node.left + wobble,
              top: node.top + wobble,
              width: node.size,
              height: node.size,
              background: palette.lime,
              boxShadow: `0 0 20px ${palette.limeSoft}`,
              opacity: 0.88,
            }}
          />
        );
      })}
    </>
  );
};

const HeroFigure = ({
  src,
  objectPosition,
  frame,
  delay,
  portrait,
  heroStyle,
}: {
  src: string;
  objectPosition: string;
  frame: number;
  delay: number;
  portrait: boolean;
  heroStyle: React.CSSProperties;
}) => {
  const {fps} = useVideoConfig();
  const inView = rise(frame, fps, delay, 20);
  const float = Math.sin((frame - delay) / 22) * (portrait ? 5 : 4);

  return (
    <div
      style={{
        position: 'absolute',
        overflow: 'visible',
        filter: 'drop-shadow(0 22px 34px rgba(0,0,0,0.08))',
        ...heroStyle,
        ...entranceStyle(inView, 34, 0.97),
      }}
    >
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition,
          transform: `translateY(${float}px) scale(1.02)`,
        }}
      />
    </div>
  );
};

const RightWordmark = ({
  frame,
  portrait,
  title,
  subtitle,
  micro,
}: {
  frame: number;
  portrait: boolean;
  title: string;
  subtitle: string;
  micro: string;
}) => {
  const {fps} = useVideoConfig();
  const wordmarkIn = rise(frame, fps, 6, 20);
  const copyIn = rise(frame, fps, 14, 20);

  return (
    <div
      style={{
        position: 'absolute',
        left: portrait ? 90 : 1030,
        right: portrait ? 90 : 120,
        top: portrait ? 1060 : 260,
      }}
    >
      <div
        style={{
          fontFamily: display,
          fontSize: portrait ? 118 : 126,
          lineHeight: 0.9,
          letterSpacing: '-0.05em',
          textTransform: 'uppercase',
          color: palette.ink,
          ...entranceStyle(wordmarkIn, 18, 0.99),
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: portrait ? 26 : 22,
          fontFamily: mono,
          fontSize: portrait ? 22 : 16,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: palette.softInk,
          ...entranceStyle(copyIn, 16, 1),
        }}
      >
        {subtitle}
      </div>
      <div
        style={{
          marginTop: 26,
          fontFamily: mono,
          fontSize: portrait ? 18 : 15,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: palette.mutedInk,
          ...entranceStyle(copyIn, 16, 1),
        }}
      >
        {micro}
      </div>
    </div>
  );
};

const SceneHeader = ({
  kicker,
  title,
  bodyCopy,
  frame,
  portrait,
  top,
  width,
  titleSize,
  bodyWidth,
  bodySize,
  bodyMarginTop,
}: {
  kicker: string;
  title: string;
  bodyCopy: string;
  frame: number;
  portrait: boolean;
  top?: number;
  width?: number;
  titleSize?: number;
  bodyWidth?: number;
  bodySize?: number;
  bodyMarginTop?: number;
}) => {
  const {fps} = useVideoConfig();
  const inKicker = rise(frame, fps, 0, 20);
  const inTitle = rise(frame, fps, 6, 20);
  const inBody = rise(frame, fps, 12, 20);

  return (
    <div
      style={{
        position: 'absolute',
        left: portrait ? 90 : 92,
        top: top ?? (portrait ? 172 : 158),
        width: width ?? (portrait ? 900 : 760),
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: portrait ? 24 : 20,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: palette.softInk,
          ...entranceStyle(inKicker, 18, 1),
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          marginTop: 20,
          fontFamily: display,
          fontSize: titleSize ?? (portrait ? 106 : 92),
          lineHeight: 0.92,
          letterSpacing: '-0.04em',
          textTransform: 'uppercase',
          color: palette.ink,
          ...entranceStyle(inTitle, 20, 0.99),
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: bodyMarginTop ?? 24,
          width: bodyWidth ?? (portrait ? 860 : 680),
          fontFamily: body,
          fontSize: bodySize ?? (portrait ? 38 : 28),
          lineHeight: 1.32,
          color: palette.softInk,
          ...entranceStyle(inBody, 18, 1),
        }}
      >
        {bodyCopy}
      </div>
    </div>
  );
};

const MetricCard = ({
  x,
  y,
  w,
  h,
  label,
  value,
  note,
  frame,
  delay,
  valueSize,
  labelSize,
  noteSize,
  padding,
  valueMarginTop,
  noteGap,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: string;
  note?: string;
  frame: number;
  delay: number;
  valueSize?: number;
  labelSize?: number;
  noteSize?: number;
  padding?: string;
  valueMarginTop?: number;
  noteGap?: number;
}) => {
  const {fps} = useVideoConfig();
  const inView = rise(frame, fps, delay, 21);

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        padding: padding ?? '20px 28px',
        border: `1px solid ${palette.lineStrong}`,
        background: 'rgba(243, 239, 231, 0.94)',
        display: 'flex',
        flexDirection: 'column',
        ...entranceStyle(inView, 20, 0.985),
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: labelSize ?? 18,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: palette.mutedInk,
          lineHeight: 1.35,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: valueMarginTop ?? 12,
          fontFamily: display,
          fontSize: valueSize ?? Math.min(76, w * 0.28),
          lineHeight: 0.92,
          letterSpacing: '-0.05em',
          textTransform: 'uppercase',
          color: palette.ink,
        }}
      >
        {value}
      </div>
      {note ? (
        <div
          style={{
            marginTop: 'auto',
            paddingTop: noteGap ?? 10,
            fontFamily: mono,
            fontSize: noteSize ?? 14,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: palette.mutedInk,
            lineHeight: 1.2,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
};

const AgentCard = ({
  x,
  y,
  w,
  h,
  label,
  caption,
  art,
  frame,
  delay,
  portrait,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  caption: string;
  art: {src: string; position: string};
  frame: number;
  delay: number;
  portrait: boolean;
}) => {
  const {fps} = useVideoConfig();
  const inView = rise(frame, fps, delay, 20);

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        border: `1px solid ${palette.lineStrong}`,
        background: 'rgba(255,255,255,0.54)',
        overflow: 'hidden',
        ...entranceStyle(inView, 28, 0.985),
      }}
    >
      <Img
        src={art.src}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: art.position,
          transform: portrait ? 'scale(1.08)' : 'scale(1.04)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 55%, rgba(243,239,231,0.92) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 18,
          top: 18,
          fontFamily: mono,
          fontSize: portrait ? 18 : 15,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: palette.softInk,
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 18,
          right: 18,
          bottom: 20,
          fontFamily: body,
          fontSize: portrait ? 22 : 18,
          lineHeight: 1.25,
          color: palette.ink,
        }}
      >
        {caption}
      </div>
    </div>
  );
};

const ProcessRail = ({
  items,
  frame,
  portrait,
  y,
}: {
  items: Array<{step: string; label: string; desc: string}>;
  frame: number;
  portrait: boolean;
  y: number;
}) => {
  const startX = portrait ? 92 : 92;
  const width = portrait ? 896 : 1628;
  const railTop = y;
  const {fps} = useVideoConfig();

  return (
    <div
      style={{
        position: 'absolute',
        left: startX,
        top: railTop,
        width,
      }}
    >
      {!portrait ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 30,
            height: 2,
            background: palette.lineStrong,
          }}
        />
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: portrait ? '1fr' : `repeat(${items.length}, minmax(0, 1fr))`,
          gap: 18,
        }}
      >
        {items.map((item, index) => {
          const inView = rise(frame, fps, index * 6, 22);
          return (
            <div
              key={item.step}
              style={{
                minHeight: portrait ? 118 : 150,
                padding: portrait ? '18px 22px' : '20px 22px 18px',
                border: `1px solid ${palette.lineStrong}`,
                background: index === items.length - 1 ? 'rgba(226, 244, 214, 0.96)' : 'rgba(243, 239, 231, 0.96)',
                ...entranceStyle(inView, 18, 0.99),
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: index === items.length - 1 ? palette.lime : palette.ink,
                  }}
                />
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: portrait ? 17 : 14,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: palette.softInk,
                  }}
                >
                  {item.step}
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  fontFamily: display,
                  fontSize: portrait ? 34 : 28,
                  lineHeight: 0.98,
                  letterSpacing: '-0.03em',
                  textTransform: 'uppercase',
                  color: palette.ink,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  marginTop: 14,
                  fontFamily: body,
                  fontSize: portrait ? 21 : 17,
                  lineHeight: 1.3,
                  color: palette.softInk,
                }}
              >
                {item.desc}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const RouteCard = ({
  x,
  y,
  w,
  h,
  label,
  copy,
  frame,
  delay,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  copy: string;
  frame: number;
  delay: number;
}) => {
  const {fps} = useVideoConfig();
  const inView = rise(frame, fps, delay, 20);

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        padding: '24px 24px 22px',
        border: `1px solid ${palette.lineStrong}`,
        background: palette.whiteGlass,
        ...entranceStyle(inView, 24, 0.985),
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: 18,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: palette.softInk,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 18,
          fontFamily: body,
          fontSize: 22,
          lineHeight: 1.32,
          color: palette.ink,
        }}
      >
        {copy}
      </div>
    </div>
  );
};

const IntroScene = ({frame, portrait}: {frame: number; portrait: boolean}) => {
  return (
    <>
      <HeroFigure
        src={agents.hero.src}
        objectPosition={agents.hero.position}
        frame={frame}
        delay={0}
        portrait={portrait}
        heroStyle={
          portrait
            ? {left: 140, top: 210, width: 760, height: 760}
            : {left: 360, top: 90, width: 620, height: 700}
        }
      />
      <RightWordmark
        frame={frame}
        portrait={portrait}
        title="SAEP"
        subtitle="SOLANA AGENT ECONOMY PROTOCOL"
        micro="REGISTER // STAKE // GOVERN // EARN"
      />
    </>
  );
};

const HireScene = ({frame, portrait}: {frame: number; portrait: boolean}) => {
  const metric = portrait
    ? {x: 92, y: 540, w: 896, h: 150, valueSize: 50}
    : {x: 1510, y: 178, w: 266, h: 186, valueSize: 56};

  return (
    <>
      <SceneHeader
        kicker="01 / Hire, Prove, Pay"
        title={portrait ? 'Agent A hires Agent B.' : 'Agent A hires Agent B on-chain.'}
        bodyCopy="Intent opens on-chain, SAEP escrows the value, the result gets wrapped in a proof, and settlement releases atomically in under one slot."
        frame={frame}
        portrait={portrait}
        width={portrait ? 900 : 1280}
        titleSize={portrait ? 74 : 76}
        bodyWidth={portrait ? 860 : 760}
        bodySize={portrait ? 34 : 22}
      />
      <MetricCard
        x={metric.x}
        y={metric.y}
        w={metric.w}
        h={metric.h}
        label="Settlement clock"
        value="<1 slot"
        note="proof-gated release"
        frame={frame}
        delay={8}
        valueSize={metric.valueSize}
        labelSize={portrait ? 12 : 16}
        noteSize={portrait ? 11 : 12}
        padding={portrait ? '16px 24px' : '22px 26px'}
        valueMarginTop={portrait ? 8 : 12}
        noteGap={8}
      />
      <AgentCard
        x={portrait ? 92 : 92}
        y={portrait ? 700 : 470}
        w={portrait ? 428 : 350}
        h={portrait ? 340 : 360}
        label="Agent A"
        caption="Publishes the job, commits escrow, and prices the outcome on-chain."
        art={agents.a}
        frame={frame}
        delay={8}
        portrait={portrait}
      />
      <AgentCard
        x={portrait ? 560 : 478}
        y={portrait ? 700 : 470}
        w={portrait ? 428 : 350}
        h={portrait ? 340 : 360}
        label="Agent B"
        caption="Executes the task and ships a proof-backed completion artifact."
        art={agents.d}
        frame={frame}
        delay={14}
        portrait={portrait}
      />
      <ProcessRail
        portrait={portrait}
        frame={frame + 12}
        y={portrait ? 1072 : 840}
        items={[
          {step: '01', label: 'Task posted', desc: 'Agent A opens the job and SAEP locks the payment path.'},
          {step: '02', label: 'Proof clears', desc: 'Execution resolves into a proof instead of a private webhook.'},
          {step: '03', label: 'Escrow signs off', desc: 'The verifier unlocks the release condition inside SAEP.'},
          {step: '04', label: 'Payout lands', desc: 'Payment settles in under one slot with no operator in the middle.'},
        ]}
      />
    </>
  );
};

const BridgeScene = ({frame, portrait}: {frame: number; portrait: boolean}) => {
  return (
    <>
      <SceneHeader
        kicker="02 / Cross-ecosystem routing"
        title={portrait ? 'XRP to Pyth to SAEP escrow.' : 'XRP -> Pyth -> SAEP escrow.'}
        bodyCopy="Value can begin outside Solana. Pyth prices the route. SAEP locks the proof-bound escrow leg where the coordination speed actually exists."
        frame={frame}
        portrait={portrait}
        top={portrait ? 170 : 158}
        width={portrait ? 900 : 1200}
        titleSize={portrait ? 72 : 82}
        bodyWidth={portrait ? 860 : 860}
        bodySize={portrait ? 28 : 22}
        bodyMarginTop={18}
      />
      <HeroFigure
        src={agents.c.src}
        objectPosition={agents.c.position}
        frame={frame}
        delay={8}
        portrait={portrait}
        heroStyle={
          portrait
            ? {left: 182, top: 728, width: 688, height: 430}
            : {left: 86, top: 438, width: 410, height: 492}
        }
      />
      <MetricCard
        x={portrait ? 92 : 1508}
        y={portrait ? 564 : 176}
        w={portrait ? 896 : 270}
        h={portrait ? 148 : 180}
        label="Why Solana"
        value={portrait ? 'speed + finality' : 'speed + finality'}
        note="proof-bound settlement"
        frame={frame}
        delay={10}
        valueSize={portrait ? 46 : 36}
        labelSize={portrait ? 12 : 16}
        noteSize={portrait ? 11 : 12}
        padding={portrait ? '16px 24px' : '22px 26px'}
        valueMarginTop={portrait ? 8 : 12}
        noteGap={8}
      />
      <RouteCard
        x={portrait ? 92 : 630}
        y={portrait ? 1204 : 572}
        w={portrait ? 896 : 320}
        h={portrait ? 152 : 198}
        label="XRP"
        copy="Cross-ecosystem demand and value show up from the XRP side of the route."
        frame={frame}
        delay={12}
      />
      <RouteCard
        x={portrait ? 92 : 988}
        y={portrait ? 1380 : 572}
        w={portrait ? 896 : 320}
        h={portrait ? 152 : 198}
        label="Pyth"
        copy="Pyth supplies the pricing membrane, quote confidence, and route discipline."
        frame={frame}
        delay={18}
      />
      <RouteCard
        x={portrait ? 92 : 1346}
        y={portrait ? 1556 : 572}
        w={portrait ? 896 : 320}
        h={portrait ? 172 : 198}
        label="SAEP escrow"
        copy="The final coordination leg settles inside proof-bound escrow on Solana."
        frame={frame}
        delay={24}
      />
    </>
  );
};

const SwarmChip = ({
  x,
  y,
  art,
  label,
  frame,
  delay,
}: {
  x: number;
  y: number;
  art: {src: string; position: string};
  label: string;
  frame: number;
  delay: number;
}) => {
  const {fps} = useVideoConfig();
  const inView = rise(frame, fps, delay, 22);
  const bob = Math.sin((frame - delay) / 12) * 5;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y + bob,
        width: 184,
        height: 204,
        border: `1px solid ${palette.lineStrong}`,
        background: 'rgba(255,255,255,0.54)',
        overflow: 'hidden',
        ...entranceStyle(inView, 16, 0.98),
      }}
    >
      <Img
        src={art.src}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: art.position,
          transform: 'scale(1.05)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 14,
          bottom: 14,
          fontFamily: mono,
          fontSize: 15,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: palette.ink,
          background: 'rgba(243,239,231,0.94)',
          padding: '6px 8px',
        }}
      >
        {label}
      </div>
    </div>
  );
};

const SwarmScene = ({frame, portrait}: {frame: number; portrait: boolean}) => {
  return (
    <>
      <SceneHeader
        kicker="03 / High-frequency swarm"
        title={portrait ? 'Many agents. One proof-bound clock.' : 'High-frequency agent swarm.'}
        bodyCopy="The loop only stays coherent if the chain is fast enough to coordinate it and the protocol is strict enough to require proofs before payment."
        frame={frame}
        portrait={portrait}
        width={portrait ? 900 : 1180}
        titleSize={portrait ? 72 : 78}
        bodyWidth={portrait ? 880 : 760}
        bodySize={portrait ? 28 : 22}
        bodyMarginTop={18}
      />
      <MetricCard
        x={portrait ? 92 : 1508}
        y={portrait ? 500 : 176}
        w={portrait ? 896 : 270}
        h={portrait ? 150 : 180}
        label="Constraint"
        value="proof first"
        note="slot-paced coordination"
        frame={frame}
        delay={10}
        valueSize={portrait ? 48 : 40}
        labelSize={portrait ? 12 : 16}
        noteSize={portrait ? 11 : 12}
        padding={portrait ? '16px 24px' : '22px 26px'}
        valueMarginTop={portrait ? 8 : 10}
        noteGap={8}
      />
      <HeroFigure
        src={agents.b.src}
        objectPosition={agents.b.position}
        frame={frame}
        delay={10}
        portrait={portrait}
        heroStyle={
          portrait
            ? {left: 124, top: 620, width: 840, height: 620}
            : {left: 108, top: 430, width: 390, height: 520}
        }
      />
      {portrait ? (
        <>
          <SwarmChip x={92} y={1278} art={agents.a} label="route" frame={frame} delay={12} />
          <SwarmChip x={300} y={1278} art={agents.c} label="bid" frame={frame} delay={16} />
          <SwarmChip x={508} y={1278} art={agents.d} label="prove" frame={frame} delay={20} />
          <SwarmChip x={716} y={1278} art={agents.hero} label="release" frame={frame} delay={24} />
          <RouteCard
            x={92}
            y={1518}
            w={896}
            h={166}
            label="Proof-bound cadence"
            copy="Bid. Execute. Prove. Release. The swarm only works because Solana stays fast and SAEP keeps payout proof-first."
            frame={frame}
            delay={28}
          />
        </>
      ) : (
        <>
          <SwarmChip x={672} y={460} art={agents.a} label="route" frame={frame} delay={12} />
          <SwarmChip x={908} y={620} art={agents.c} label="bid" frame={frame} delay={16} />
          <SwarmChip x={1144} y={460} art={agents.d} label="prove" frame={frame} delay={20} />
          <SwarmChip x={1380} y={620} art={agents.hero} label="release" frame={frame} delay={24} />
          <SwarmChip x={1616} y={460} art={agents.b} label="rebid" frame={frame} delay={28} />
        </>
      )}
      {portrait ? null : (
        <ProcessRail
          portrait={portrait}
          frame={frame + 10}
          y={846}
          items={[
            {step: '01', label: 'Bid', desc: 'Agents coordinate at slot cadence instead of human pacing.'},
            {step: '02', label: 'Execute', desc: 'Specialized workers fan out and return results in parallel.'},
            {step: '03', label: 'Prove', desc: 'Proofs bind the output to the settlement condition.'},
            {step: '04', label: 'Release', desc: 'SAEP pays automatically once the proof path clears.'},
          ]}
        />
      )}
    </>
  );
};

const OutroScene = ({frame, portrait}: {frame: number; portrait: boolean}) => {
  const {fps} = useVideoConfig();
  const inView = rise(frame, fps, 4, 20);

  return (
    <>
      <HeroFigure
        src={agents.hero.src}
        objectPosition={agents.hero.position}
        frame={frame}
        delay={0}
        portrait={portrait}
        heroStyle={
          portrait
            ? {left: 154, top: 250, width: 780, height: 760}
            : {left: 360, top: 86, width: 620, height: 720}
        }
      />
      <div
        style={{
          position: 'absolute',
          left: portrait ? 94 : 1010,
          right: portrait ? 94 : 122,
          top: portrait ? 1060 : 244,
          ...entranceStyle(inView, 24, 0.99),
        }}
      >
        <div
          style={{
            fontFamily: mono,
            fontSize: portrait ? 22 : 18,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: palette.softInk,
          }}
        >
          SAEP + Solana
        </div>
        <div
          style={{
            marginTop: 24,
            fontFamily: display,
            fontSize: portrait ? 98 : 100,
            lineHeight: 0.92,
            letterSpacing: '-0.05em',
            textTransform: 'uppercase',
            color: palette.ink,
          }}
        >
          This is only possible on Solana&apos;s speed + SAEP proofs.
        </div>
        <div
          style={{
            marginTop: 26,
            width: portrait ? 860 : 690,
            fontFamily: body,
            fontSize: portrait ? 34 : 28,
            lineHeight: 1.3,
            color: palette.softInk,
          }}
        >
          Fast enough to coordinate the swarm. Strict enough to make the swarm trustworthy.
        </div>
      </div>
    </>
  );
};

export const SaepSpeedProofs: React.FC<Props> = ({
  layout,
  voiceoverSrc = null,
  voiceoverPlaybackRate = 1,
}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const portrait = layout === 'portrait';

  return (
    <AbsoluteFill style={{width, height, color: palette.ink}}>
      {voiceoverSrc ? <Audio src={staticFile(voiceoverSrc)} playbackRate={voiceoverPlaybackRate} /> : null}
      <FrameChrome frame={frame} portrait={portrait} />
      <FloatingMarks frame={frame} portrait={portrait} />

      <Sequence from={sceneOffsets.intro} durationInFrames={INTRO}>
        <IntroScene frame={sceneFrame(frame, sceneOffsets.intro)} portrait={portrait} />
      </Sequence>

      <Sequence from={sceneOffsets.hire} durationInFrames={HIRE_SCENE}>
        <HireScene frame={sceneFrame(frame, sceneOffsets.hire)} portrait={portrait} />
      </Sequence>

      <Sequence from={sceneOffsets.bridge} durationInFrames={BRIDGE_SCENE}>
        <BridgeScene frame={sceneFrame(frame, sceneOffsets.bridge)} portrait={portrait} />
      </Sequence>

      <Sequence from={sceneOffsets.swarm} durationInFrames={SWARM_SCENE}>
        <SwarmScene frame={sceneFrame(frame, sceneOffsets.swarm)} portrait={portrait} />
      </Sequence>

      <Sequence from={sceneOffsets.outro} durationInFrames={OUTRO}>
        <OutroScene frame={sceneFrame(frame, sceneOffsets.outro)} portrait={portrait} />
      </Sequence>
    </AbsoluteFill>
  );
};
